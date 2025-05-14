import { connect, Client } from "@dagger.io/dagger"

// initialize Dagger client
connect(
  async (client: Client) => {

    // get reference to the local project
    const source = client.host().directory(".", { exclude: ["node_modules/"] })

    // get Node image
    const node = client.container().from("node:latest")

    // mount cloned repository into Node image
    const runner = node
      .withDirectory("/src", source)
      .withWorkdir("/src")
      .withExec(["npm", "install"])

    // run tests
    // await runner.withExec(["npm", "test", "--", "--watchAll=false"]).sync()

    // build application
    // write the build output to the host
    await runner
      .withExec(["npm", "run", "build"])
      .directory("dist/")
      .export("./dist")
  },
  { LogOutput: process.stderr },
)
