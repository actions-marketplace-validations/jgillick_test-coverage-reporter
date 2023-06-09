import crypto from "crypto";
import * as github from "@actions/github";
import { Inputs, CoverageSummary } from "./types";

type Octokit = ReturnType<typeof github.getOctokit>;
type PrFile = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["listFiles"]>
>["data"][0];

/**
 * A helper class that holds a list of all the files included in the PR
 * and provides helper methods to query this list.
 */
export default class PRFiles {
  inputs: Inputs;
  files: string[];
  fileMap: Map<string, PrFile>;
  pathPrefix: string = "";

  constructor(inputs: Inputs) {
    this.files = [];
    this.pathPrefix = "";
    this.inputs = inputs;
    this.fileMap = new Map<string, PrFile>();
  }

  /**
   * Is this coverage file included in the list of PR files
   */
  inPR(filepath: string): boolean {
    if (filepath.startsWith(this.pathPrefix)) {
      filepath = filepath.substring(this.pathPrefix.length);
    }
    return this.files.includes(filepath);
  }

  /**
   * Get the URL to the file in the PR commit
   */
  fileUrl(filepath: string): string | null {
    // Construct the PR URL
    const repoUrl = this.inputs.context.payload.repository?.html_url;
    const prNumber = this.inputs.context.payload.pull_request?.number;

    if (!repoUrl || !prNumber) {
      return null;
    }

    const baseUrl = `${repoUrl}/pull/${prNumber}/files`;

    // File path sha
    if (filepath.startsWith(this.pathPrefix)) {
      filepath = filepath.substring(this.pathPrefix.length);
    }
    const filenameSha = crypto
      .createHash("sha256")
      .update(filepath)
      .digest("hex");

    return `${baseUrl}#diff-${filenameSha}`;
  }

  /**
   * Load the list of files included in the PR
   */
  async fetchPRFiles() {
    const client = github.getOctokit(this.inputs.accessToken);

    const repoName = this.inputs.context.repo.repo;
    const repoOwner = this.inputs.context.repo.owner;
    const prNumber = this.inputs.context.issue.number;

    const results = await client.paginate(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      {
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
      }
    );

    // Get the list of file names and sort them by length
    this.files = results.map((file) => file.filename).sort(pathSort);

    // Add files to map
    this.fileMap = new Map<string, PrFile>();
    results.forEach((file) => this.fileMap.set(file.filename, file));
  }

  /**
   * Read the test coverage file and extract a list of files that are included in the PR
   */
  async loadCoverage(coverage: CoverageSummary) {
    // Fetch PR files, if they haven't already been loaded
    if (!this.files.length) {
      await this.fetchPRFiles();
    }

    // Get list of coverage files
    const coverageFiles = Object.keys(coverage)
      .filter((i) => i !== "total")
      .sort(pathSort);

    // Find the first PR file that matches a coverage file and extract the path root
    this.pathPrefix = "";
    for (let prFile of this.files) {
      const coverageFile = coverageFiles.find((path) => path.endsWith(prFile));

      // Extract path prefix from coverage report file
      if (coverageFile) {
        const prefixLen = coverageFile.length - prFile.length;
        this.pathPrefix = coverageFile.substring(0, prefixLen);
        break;
      }
    }
  }
}

/**
 * Sort with the path closest to root at the top
 */
function pathSort(pathA: string, pathB: string) {
  const depthA = pathA.match(/\//g)?.length || 0;
  const depthB = pathB.match(/\//g)?.length || 0;
  if (depthA === depthB) {
    return pathA.localeCompare(pathB);
  }
  return depthA - depthB;
}
