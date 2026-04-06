import { $ } from "bun";
import { DOCKER_NETWORK_RUNNER, DOCKER_NETWORK_INTERNAL } from "@voss/shared";

/**
 * Verify that all required dependencies are running before starting the server.
 * Exits with clear error message if anything is missing.
 */
export async function checkDependencies() {
  console.log("Checking dependencies...");

  // Docker daemon
  try {
    await $`docker info`.quiet();
    console.log("  ✓ Docker");
  } catch {
    console.error("  ✕ Docker daemon is not running");
    console.error("    Fix: Start Docker with 'sudo systemctl start docker'");
    process.exit(1);
  }

  // Docker networks
  for (const network of [DOCKER_NETWORK_RUNNER, DOCKER_NETWORK_INTERNAL]) {
    try {
      await $`docker network inspect ${network}`.quiet();
      console.log(`  ✓ Network: ${network}`);
    } catch {
      console.log(`  Creating network: ${network}...`);
      await $`docker network create ${network}`;
      console.log(`  ✓ Network: ${network} (created)`);
    }
  }

  // Traefik
  try {
    const result = await $`docker ps --filter name=traefik --format '{{.Names}}'`.quiet();
    const name = result.text().trim();
    if (name) {
      console.log("  ✓ Traefik");
    } else {
      console.error("  ✕ Traefik container is not running");
      console.error("    Fix: Start Traefik with the install script");
      process.exit(1);
    }
  } catch {
    console.error("  ✕ Could not check Traefik status");
    process.exit(1);
  }

  // Disk space
  try {
    const result = await $`df -BM / --output=avail`.quiet();
    const lines = result.text().trim().split("\n");
    const availMB = parseInt(lines[lines.length - 1]);
    if (availMB < 1024) {
      console.error(`  ✕ Low disk space: ${availMB}MB available (need 1GB+)`);
      process.exit(1);
    }
    console.log(`  ✓ Disk: ${availMB}MB available`);
  } catch {
    console.log("  ? Disk check skipped (non-Linux)");
  }

  console.log("All checks passed.\n");
}
