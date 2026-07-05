// Package main implements the devtool command-line tool for WebCAD workspace automation.
package main

import (
	"context"
	"encoding/json"
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

	// Run command flags
	runCheckCmd.Flags().String("name", "", "Name of the check run (required)")
	runCheckCmd.Flags().String("sha", "", "Commit SHA (defaults to GITHUB_SHA env var)")
	runCheckCmd.Flags().Bool("preregistered", false, "Ensure the status check is already registered before executing")
	_ = runCheckCmd.MarkFlagRequired("name")

	// Register command flags
	registerCmd.Flags().StringSlice("name", nil, "Names of the status checks to register (required)")
	registerCmd.Flags().String("sha", "", "Commit SHA (defaults to GITHUB_SHA env var)")
	_ = registerCmd.MarkFlagRequired("name")

	githubCiCmd.AddCommand(runCheckCmd)
	githubCiCmd.AddCommand(registerCmd)
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

var registerCmd = &cobra.Command{
	Use:   "register",
	Short: "Pre-register one or more pending commit statuses",
	RunE: func(cmd *cobra.Command, args []string) error {
		names, _ := cmd.Flags().GetStringSlice("name")
		sha, _ := cmd.Flags().GetString("sha")
		if sha == "" {
			sha = os.Getenv("GITHUB_SHA")
		}

		client, owner, repo, err := getGitHubClient(cmd)
		if err != nil {
			if isForkPR() {
				fmt.Fprintf(os.Stderr, "Warning: failed to initialize GitHub client: %v\n", err)
				return nil
			}
			return fmt.Errorf("failed to initialize GitHub client: %w", err)
		}

		if sha != "" && client != nil {
			ctx := context.Background()
			targetURL := os.Getenv("GITHUB_SERVER_URL") + "/" + os.Getenv("GITHUB_REPOSITORY") + "/actions/runs/" + os.Getenv("GITHUB_RUN_ID")
			for _, name := range names {
				_, _, createErr := client.Repositories.CreateStatus(ctx, owner, repo, sha, &github.RepoStatus{
					State:       github.String("pending"),
					Context:     github.String(name),
					Description: github.String("Pending execution..."),
					TargetURL:   github.String(targetURL),
				})
				if createErr != nil {
					if isForkPR() && isUnauthorized(createErr) {
						fmt.Fprintf(os.Stderr, "Warning: GITHUB_TOKEN lacks permission to manage commit statuses: %v\n", createErr)
					} else {
						return fmt.Errorf("failed to create commit status for %q: %w", name, createErr)
					}
				} else {
					fmt.Fprintf(os.Stderr, "devtool debug: pre-registered pending status check %q\n", name)
				}
			}
		}
		return nil
	},
}

var runCheckCmd = &cobra.Command{
	Use:   "run-check",
	Short: "Execute a command and report its status as a GitHub commit status",
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			return fmt.Errorf("no command specified to run")
		}

		name, _ := cmd.Flags().GetString("name")
		sha, _ := cmd.Flags().GetString("sha")
		if sha == "" {
			sha = os.Getenv("GITHUB_SHA")
		}
		preregistered, _ := cmd.Flags().GetBool("preregistered")

		fmt.Fprintf(os.Stderr, "devtool debug: name=%q, sha=%q, preregistered=%v, args=%v\n", name, sha, preregistered, args)

		client, owner, repo, err := getGitHubClient(cmd)
		if err != nil {
			if isForkPR() {
				fmt.Fprintf(os.Stderr, "Warning: failed to initialize GitHub client: %v\n", err)
			} else {
				return fmt.Errorf("failed to initialize GitHub client: %w", err)
			}
		} else if sha != "" && client != nil {
			ctx := context.Background()
			if preregistered {
				status, _, getErr := client.Repositories.GetCombinedStatus(ctx, owner, repo, sha, nil)
				if getErr != nil {
					if isForkPR() && isUnauthorized(getErr) {
						fmt.Fprintf(os.Stderr, "Warning: failed to query commit statuses: %v\n", getErr)
					} else {
						return fmt.Errorf("failed to check pre-registration: %w", getErr)
					}
				} else {
					found := false
					for _, st := range status.Statuses {
						if st.GetContext() == name {
							found = true
							break
						}
					}
					if !found {
						if isForkPR() {
							fmt.Fprintf(os.Stderr, "Warning: status check %q was not pre-registered\n", name)
						} else {
							return fmt.Errorf("status check %q was not pre-registered as required by --preregistered flag", name)
						}
					}
				}
			}

			targetURL := os.Getenv("GITHUB_SERVER_URL") + "/" + os.Getenv("GITHUB_REPOSITORY") + "/actions/runs/" + os.Getenv("GITHUB_RUN_ID")
			_, _, createErr := client.Repositories.CreateStatus(ctx, owner, repo, sha, &github.RepoStatus{
				State:       github.String("pending"),
				Context:     github.String(name),
				Description: github.String("Check is running..."),
				TargetURL:   github.String(targetURL),
			})
			if createErr != nil {
				if isForkPR() && isUnauthorized(createErr) {
					fmt.Fprintf(os.Stderr, "Warning: GITHUB_TOKEN lacks permission to manage commit statuses: %v\n", createErr)
				} else {
					return fmt.Errorf("failed to create commit status: %w", createErr)
				}
			} else {
				fmt.Fprintf(os.Stderr, "devtool debug: created pending status check %q\n", name)
			}
		}

		// Execute the command in bash to support piping and logical operators (&&, ||)
		shellCmd := strings.Join(args, " ")
		c := exec.Command("bash", "-c", shellCmd)
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		c.Stdin = os.Stdin

		runErr := c.Run()
		stateStr := "success"
		desc := "Check completed successfully"
		if runErr != nil {
			stateStr = "failure"
			desc = "Check failed: " + runErr.Error()
			if len(desc) > 140 {
				desc = desc[:137] + "..."
			}
		}

		// Update commit status
		if client != nil && sha != "" {
			ctx := context.Background()
			targetURL := os.Getenv("GITHUB_SERVER_URL") + "/" + os.Getenv("GITHUB_REPOSITORY") + "/actions/runs/" + os.Getenv("GITHUB_RUN_ID")
			_, _, updateErr := client.Repositories.CreateStatus(ctx, owner, repo, sha, &github.RepoStatus{
				State:       github.String(stateStr),
				Context:     github.String(name),
				Description: github.String(desc),
				TargetURL:   github.String(targetURL),
			})
			if updateErr != nil {
				if isForkPR() && isUnauthorized(updateErr) {
					fmt.Fprintf(os.Stderr, "Warning: failed to update commit status: %v\n", updateErr)
				} else {
					return fmt.Errorf("failed to update commit status: %w", updateErr)
				}
			} else {
				fmt.Fprintf(os.Stderr, "devtool debug: updated status check %q to %s\n", name, stateStr)
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

type githubEvent struct {
	PullRequest *struct {
		Head *struct {
			Repo *struct {
				Fork bool `json:"fork"`
			} `json:"repo"`
		} `json:"head"`
	} `json:"pull_request"`
}

func isForkPR() bool {
	eventPath := os.Getenv("GITHUB_EVENT_PATH")
	if eventPath == "" {
		return false
	}
	data, err := os.ReadFile(eventPath)
	if err != nil {
		return false
	}
	var event githubEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return false
	}
	if event.PullRequest != nil && event.PullRequest.Head != nil && event.PullRequest.Head.Repo != nil {
		return event.PullRequest.Head.Repo.Fork
	}
	return false
}
