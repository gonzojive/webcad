// Package main implements the devtool command-line tool for workspace automation.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/google/go-github/v62/github"
	"github.com/spf13/cobra"
)

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

var githubCmd = &cobra.Command{
	Use:   "github",
	Short: "Manage GitHub repository integration and check runs",
}

func init() {
	rootCmd.AddCommand(githubCmd)
	githubCmd.AddCommand(checkRunCmd)

	// Add common flags to github command
	githubCmd.PersistentFlags().String("token", "", "GitHub API token (defaults to GITHUB_TOKEN env var)")
	githubCmd.PersistentFlags().String("repo", "", "GitHub repository owner/name (defaults to GITHUB_REPOSITORY env var)")

	// Create command flags
	createCheckCmd.Flags().String("name", "", "Name of the check run (required)")
	createCheckCmd.Flags().String("sha", "", "Commit SHA (defaults to GITHUB_SHA env var)")
	_ = createCheckCmd.MarkFlagRequired("name")

	// Update command flags
	updateCheckCmd.Flags().Int64("id", 0, "Check run ID (required)")
	updateCheckCmd.Flags().String("conclusion", "", "Conclusion of the check run: success, failure, neutral, etc. (required)")
	_ = updateCheckCmd.MarkFlagRequired("id")
	_ = updateCheckCmd.MarkFlagRequired("conclusion")

	checkRunCmd.AddCommand(createCheckCmd)
	checkRunCmd.AddCommand(updateCheckCmd)
}

var checkRunCmd = &cobra.Command{
	Use:   "check-run",
	Short: "Create or update check runs for commits",
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
