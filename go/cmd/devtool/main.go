// Package main implements the devtool command-line tool for WebCAD workspace automation.
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/go-github/v62/github"
	"github.com/spf13/cobra"
)

// commitHash is injected at build time using:
// go build -ldflags "-X main.commitHash=$(git log -n 1 --pretty=format:%H)"
var commitHash = "unknown"

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

var rootCmd = &cobra.Command{
	Use:   "devtool",
	Short: "devtool is a CLI tool for WebCAD repository automation",
}

var githubCiCmd = &cobra.Command{
	Use:   "github-ci",
	Short: "Manage GitHub CI status and checks",
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version and commit info",
	Run: func(cmd *cobra.Command, args []string) {
		hashOnly, _ := cmd.Flags().GetBool("hash-only")
		if hashOnly {
			fmt.Print(commitHash)
			return
		}
		fmt.Printf("devtool version 0.0.1 (commit: %s)\n", commitHash)
	},
}

var tidyCmd = &cobra.Command{
	Use:   "tidy",
	Short: "Tidy Go/npm dependencies and Gazelle configurations",
	RunE: func(cmd *cobra.Command, args []string) error {
		wd, err := os.Getwd()
		if err != nil {
			return err
		}

		var root string
		for dir := wd; dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
			if _, err := os.Stat(filepath.Join(dir, "MODULE.bazel")); err == nil {
				root = dir
				break
			}
		}
		if root == "" {
			return fmt.Errorf("could not find workspace root (MODULE.bazel)")
		}

		tidyScript := filepath.Join(root, "devtools", "tidy")
		c := exec.Command(tidyScript)
		c.Dir = root
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		c.Stdin = os.Stdin

		if err := c.Run(); err != nil {
			return fmt.Errorf("tidy script failed: %w", err)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(githubCiCmd)
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(tidyCmd)

	versionCmd.Flags().Bool("hash-only", false, "Output only the commit hash")

	// Add common flags to github-ci command
	githubCiCmd.PersistentFlags().String("token", "", "GitHub API token (defaults to GITHUB_TOKEN env var)")
	githubCiCmd.PersistentFlags().String("repo", "", "GitHub repository owner/name (defaults to GITHUB_REPOSITORY env var)")

	// Create command flags
	createCheckCmd.Flags().String("name", "", "Name of the check run (required)")
	createCheckCmd.Flags().String("sha", "", "Commit SHA (defaults to GITHUB_SHA env var)")
	_ = createCheckCmd.MarkFlagRequired("name")

	// Update command flags
	updateCheckCmd.Flags().Int64("id", 0, "Check run ID (required)")
	updateCheckCmd.Flags().String("conclusion", "", "Conclusion of the check run: success, failure, neutral, etc. (required)")
	_ = updateCheckCmd.MarkFlagRequired("id")
	_ = updateCheckCmd.MarkFlagRequired("conclusion")

	// Run command flags
	runCheckCmd.Flags().String("name", "", "Name of the check run (required)")
	runCheckCmd.Flags().String("sha", "", "Commit SHA (defaults to GITHUB_SHA env var)")
	_ = runCheckCmd.MarkFlagRequired("name")

	githubCiCmd.AddCommand(createCheckCmd)
	githubCiCmd.AddCommand(updateCheckCmd)
	githubCiCmd.AddCommand(runCheckCmd)
}

// getGitHubClient retrieves a GitHub client authenticated via token flag or GITHUB_TOKEN environment variable.
func getGitHubClient(cmd *cobra.Command) (*github.Client, string, string, error) {
	token, _ := cmd.Flags().GetString("token")
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token == "" {
		return nil, "", "", fmt.Errorf("GitHub token is required (specify --token or GITHUB_TOKEN env var)")
	}

	repoSlug, _ := cmd.Flags().GetString("repo")
	if repoSlug == "" {
		repoSlug = os.Getenv("GITHUB_REPOSITORY")
	}
	if repoSlug == "" {
		return nil, "", "", fmt.Errorf("GitHub repository is required (specify --repo or GITHUB_REPOSITORY env var)")
	}

	parts := strings.Split(repoSlug, "/")
	if len(parts) != 2 {
		return nil, "", "", fmt.Errorf("invalid repository format %q; expected owner/name", repoSlug)
	}

	client := github.NewClient(nil).WithAuthToken(token)
	return client, parts[0], parts[1], nil
}

// isUnauthorized checks if the error indicates a permission or authentication issue.
func isUnauthorized(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "401") || strings.Contains(msg, "403")
}

var createCheckCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new check run",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, owner, repo, err := getGitHubClient(cmd)
		if err != nil {
			if isUnauthorized(err) {
				fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
				return nil
			}
			return err
		}

		name, _ := cmd.Flags().GetString("name")
		sha, _ := cmd.Flags().GetString("sha")
		if sha == "" {
			sha = os.Getenv("GITHUB_SHA")
		}
		if sha == "" {
			return fmt.Errorf("commit SHA is required (specify --sha or GITHUB_SHA env var)")
		}

		ctx := context.Background()
		checkRun, _, err := client.Checks.CreateCheckRun(ctx, owner, repo, github.CreateCheckRunOptions{
			Name:    name,
			HeadSHA: sha,
			Status:  github.String("in_progress"),
		})
		if err != nil {
			if isUnauthorized(err) {
				fmt.Fprintf(os.Stderr, "Warning: GitHub token lacks permission to manage check runs: %v\n", err)
				return nil
			}
			return fmt.Errorf("failed to create check run: %w", err)
		}

		// Output only the check run ID so script steps can capture it
		fmt.Println(checkRun.GetID())
		return nil
	},
}

var updateCheckCmd = &cobra.Command{
	Use:   "update",
	Short: "Update an existing check run",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, owner, repo, err := getGitHubClient(cmd)
		if err != nil {
			if isUnauthorized(err) {
				fmt.Fprintf(os.Stderr, "Warning: %v\n", err)
				return nil
			}
			return err
		}

		id, _ := cmd.Flags().GetInt64("id")
		conclusion, _ := cmd.Flags().GetString("conclusion")

		ctx := context.Background()
		_, _, err = client.Checks.UpdateCheckRun(ctx, owner, repo, id, github.UpdateCheckRunOptions{
			Status:     github.String("completed"),
			Conclusion: github.String(conclusion),
		})
		if err != nil {
			if isUnauthorized(err) {
				fmt.Fprintf(os.Stderr, "Warning: GitHub token lacks permission to manage check runs: %v\n", err)
				return nil
			}
			return fmt.Errorf("failed to update check run: %w", err)
		}

		return nil
	},
}

var runCheckCmd = &cobra.Command{
	Use:   "run-check",
	Short: "Execute a command and report its status as a GitHub check run",
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			return fmt.Errorf("no command specified to run")
		}

		name, _ := cmd.Flags().GetString("name")
		sha, _ := cmd.Flags().GetString("sha")
		if sha == "" {
			sha = os.Getenv("GITHUB_SHA")
		}

		fmt.Fprintf(os.Stderr, "devtool debug: name=%q, sha=%q, args=%v\n", name, sha, args)

		var checkID int64
		client, owner, repo, err := getGitHubClient(cmd)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to initialize GitHub client: %v\n", err)
		} else if sha != "" {
			ctx := context.Background()
			checkRun, _, createErr := client.Checks.CreateCheckRun(ctx, owner, repo, github.CreateCheckRunOptions{
				Name:    name,
				HeadSHA: sha,
				Status:  github.String("in_progress"),
			})
			if createErr == nil {
				checkID = checkRun.GetID()
				fmt.Fprintf(os.Stderr, "devtool debug: created check run ID=%d, name=%q, url=%s\n", checkRun.GetID(), checkRun.GetName(), checkRun.GetHTMLURL())
			} else {
				fmt.Fprintf(os.Stderr, "Warning: failed to create check run: %v\n", createErr)
			}
		}

		// Execute the command in bash to support piping and logical operators (&&, ||)
		shellCmd := strings.Join(args, " ")
		c := exec.Command("bash", "-c", shellCmd)
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		c.Stdin = os.Stdin

		runErr := c.Run()
		conclusion := "success"
		if runErr != nil {
			conclusion = "failure"
		}

		// Update check run if created
		if checkID != 0 && client != nil {
			ctx := context.Background()
			_, _, updateErr := client.Checks.UpdateCheckRun(ctx, owner, repo, checkID, github.UpdateCheckRunOptions{
				Status:     github.String("completed"),
				Conclusion: github.String(conclusion),
			})
			if updateErr == nil {
				fmt.Fprintf(os.Stderr, "devtool debug: updated check run ID=%d to conclusion=%s\n", checkID, conclusion)
			} else {
				fmt.Fprintf(os.Stderr, "Warning: failed to update check run: %v\n", updateErr)
			}
		}

		if runErr != nil {
			if exitErr, ok := runErr.(*exec.ExitError); ok {
				os.Exit(exitErr.ExitCode())
			}
			return runErr
		}
		return nil
	},
}
