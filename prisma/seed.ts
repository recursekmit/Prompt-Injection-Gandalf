/**
 * Nothing to seed. Each level's flag is now a per-user `BTB{...}` value minted
 * on first play by `getOrCreateFlag`, so there is no shared word pool to
 * populate. This script stays as a no-op so `prisma db seed` (registered in
 * `prisma.config.ts`) still succeeds on a fresh clone.
 */
export {};

async function main(): Promise<void> {
  console.log("seed: nothing to do — flags are generated per user on first play");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
