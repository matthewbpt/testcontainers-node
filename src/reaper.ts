import { Socket } from "net";
import { log } from "./logger";
import { GenericContainer } from "./generic-container";
import { StartedTestContainer } from "./test-container";
import { Wait } from "./wait";
import { Id } from "./container";
import { DockerClient } from "./docker-client";

export class Reaper {
  public static IMAGE_NAME = "testcontainers/ryuk";

  private static instance: Promise<Reaper>;

  constructor(
    private readonly sessionId: Id,
    private readonly container: StartedTestContainer,
    private readonly socket: Socket
  ) {}

  public static async start(dockerClient: DockerClient): Promise<Reaper> {
    if (!this.instance) {
      this.instance = this.createInstance(dockerClient);
    }
    return this.instance;
  }

  private static async createInstance(dockerClient: DockerClient): Promise<Reaper> {
    const sessionId = dockerClient.getSessionId();

    log.debug(`Creating new Reaper for session: ${sessionId}`);
    const container = await new GenericContainer(this.IMAGE_NAME, "0.3.0")
      .withName(`ryuk-${sessionId}`)
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forLogMessage("Started!"))
      .withBindMount(dockerClient.getSocketPath() || "/var/run/docker.sock", "/var/run/docker.sock")
      .withDaemonMode()
      .withPrivilegedMode()
      .start();

    const host = dockerClient.getHost();
    const port = container.getMappedPort(8080);

    log.debug(`Connecting to Reaper on ${host}:${port}`);
    const socket = new Socket();

    socket.unref();

    socket.on("close", () => {
      log.warn("Connection to Reaper closed");
    });

    return await new Promise((resolve) => {
      socket.connect(port, host, () => {
        log.debug(`Connected to Reaper`);
        socket.write(`label=org.testcontainers.session-id=${sessionId}\r\n`);
        const reaper = new Reaper(sessionId, container, socket);
        resolve(reaper);
      });
    });
  }

  public addProject(projectName: string): void {
    this.socket.write(`label=com.docker.compose.project=${projectName}\r\n`);
  }
}
