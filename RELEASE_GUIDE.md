# How to Create a Release on GitHub

Since you have pushed the tag `v1.1.0`, GitHub knows there is a new version. Here is how to make it official:

1.  **Go to the Releases Page**:
    -   Navigate to: `https://github.com/haroldalan/spotify-karaoke/releases`

2.  **Draft a New Release**:
    -   Click the **"Draft a new release"** button.
    -   Click **"Choose a tag"** and select `v1.1.0`.

3.  **Fill in Details**:
    -   **Title**: `v1.1.0 - Stability & Performance Update`
    -   **Description**: Click the **"Generate release notes"** button! GitHub will automatically list the Pull Requests and commits included in this release.
    -   Alternatively, copy the content from `CHANGELOG.md`.

4.  **Publish**:
    -   Click **"Publish release"**.

## For Future Releases

1.  **Work on features** in a new branch (e.g., `feature/new-ui`).
2.  **Merge** the branch into `main`.
3.  **Tag** the release:
    ```bash
    git tag v1.2.0
    git push origin main --tags
    ```
4.  Repeat the steps above on GitHub.
