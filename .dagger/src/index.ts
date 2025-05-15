import {
  dag,
  Container,
  Directory,
  object,
  func,
  argument,
} from "@dagger.io/dagger"

@object()
export class HelloDagger {
  /**
   * Publish the application container after building and testing it on-the-fly
   */
  @func()
  async publish(
    @argument({ defaultPath: "/" }) source: Directory,
  ): Promise<string> {
    await this.test(source)
    return await this.build(source).publish(
      "johnhkchen/ezstack-astro",
    )
  }

  /**
   * Build the application container
   */
  @func()
  build(@argument({ defaultPath: "/" }) source: Directory): Container {
    // Base stage: common workdir setup
    const base = dag
      .container()
      .from("node:21-slim")
      .withWorkdir("/app")

    // prod-deps stage: install only production dependencies
    const prodDeps = base
      .withDirectory("/app", source, { include: ["package.json", "package-lock.json"] })
      .withExec(["npm", "install", "--omit=dev"]);

    // build-deps stage: install all dependencies (including dev)
    const buildDeps = base
      .withDirectory("/app", source)
      .withMountedCache("/root/.npm", dag.cacheVolume("npm-cache"))
      .withExec(["npm", "install"]);

    // build stage: compile the application
    const buildStage = buildDeps
      .withExec(["npm", "run", "build"]);

    // runtime stage: assemble production image
    return dag
      .container()
      .from("node:21-slim")
      .withWorkdir("/app")
      // copy production deps
      .withDirectory(
        "/app/node_modules",
        prodDeps.directory("/app/node_modules"),
      )
      // copy build output
      .withDirectory(
        "/app/dist",
        buildStage.directory("/app/dist"),
      )
      .withEnvVariable("HOST", "0.0.0.0")
      .withEnvVariable("PORT", "4321")
      .withExposedPort(4321)
      .withEntrypoint(["node", "./dist/server/entry.mjs"])
  }

  /**
   * Return the result of running unit tests
   */
  @func()
  async test(
    @argument({ defaultPath: "/" }) source: Directory,
  ): Promise<string> {
    return this.buildEnv(source)
      .withExec(["npm", "run", "test:unit", "run"])
      .stdout()
  }

  /**
   * Build a ready-to-use development environment
   */
  @func()
  buildEnv(@argument({ defaultPath: "/" }) source: Directory): Container {
    const nodeCache = dag.cacheVolume("node")
    return dag
      .container()
      .from("node:21-slim")
      .withDirectory("/src", source)
      .withMountedCache("/root/.npm", nodeCache)
      .withWorkdir("/src")
      .withExec(["npm", "install"])
  }

  /**
  * A coding agent for developing new features
  *
  * @params assignment Assignment to complete
  * @params source Optional Directory to develop on
  */
  @func()
  async develop(
      assignment: string,
      @argument({ defaultPath: '/' }) source: Directory
  ): Promise<Directory> {
      // Environment with agent inputs and outputs
      const environment = dag
          .env({ privileged: true })
          .withStringInput('assignment', assignment, 'the assignment to complete')
          .withWorkspaceInput(
          'workspace',
          dag.workspace(source),
          'the workspace with tools to edit code'
          )
          .withWorkspaceOutput('completed', 'the workspace with the completed assignment')

      // Detailed prompt stored in markdown file
      const promptFile = dag.currentModule().source().file('develop_prompt.md')

      // Put it all together to form the agent
      const work = dag.llm().withEnv(environment).withPromptFile(promptFile)

      // Get the output from the agent
      const completed = work.env().output('completed').asWorkspace()
      const completedDirectory = completed.getSource().withoutDirectory('node_modules')

      // Make sure the tests really pass
      await this.test(completedDirectory)

      // Return the Directory with the assignment completed
      return completedDirectory
  }

  /**
   * Develop with a Github issue as the assignment and open a pull request
   * @param githubToken Github Token with permissions to write issues and contents
   * @param issueID Github issue number
   * @param repository Github repository url
   * @param source The source directory
   */
  @func()
  async developIssue(
    githubToken: Secret,
    issueID: number,
    repository: string,
    @argument({ defaultPath: '/' }) source: Directory
  ): Promise<string> {
    // Get the Github issue
    const issueClient = dag.githubIssue({ token: githubToken })
    const issue = issueClient.read(repository, issueID)

    // Get information from the Github issue
    const assignment = await issue.body()

    // Solve the issue with the Develop agent
    const feature = await this.develop(assignment, source)

    // Open a pull request
    const title = await issue.title()
    const url = await issue.url()
    const body = `${assignment}\n\nCloses ${url}`
    const pr = issueClient.createPullRequest(repository, title, body, feature)

    return await pr.url()
  }

}
