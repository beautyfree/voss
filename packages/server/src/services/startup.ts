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

  // Traefik (non-fatal — may still be starting)
  try {
    const result = await $`docker ps --filter name=traefik --format '{{.Names}}'`.quiet();
    const name = result.text().trim();
    if (name) {
      console.log("  ✓ Traefik");
    } else {
      console.log("  ⚠ Traefik not running yet (deploys will fail until it starts)");
    }
  } catch {
    console.log("  ⚠ Could not check Traefik status");
  }

  // Disk space
  try {
    const result = await $`df -m / | tail -1 | awk '{print $4}'`.quiet();
    const availMB = parseInt(result.text().trim());
    if (!isNaN(availMB)) {
      if (availMB < 1024) {
        console.log(`  ⚠ Low disk space: ${availMB}MB available (recommend 1GB+)`);
      } else {
        console.log(`  ✓ Disk: ${availMB}MB available`);
      }
    }
  } catch {
    // Ignore — non-critical
  }

  console.log("All checks passed.\n");
}
