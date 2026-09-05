/**
 * Bootstraps the first login user, since there is no self-serve signup UI.
 * Usage: npx tsx scripts/create-user.ts you@company.com 'a-strong-password' "Your Name"
 */
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> <password> [name]");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, name: name ?? null })
    .returning();

  console.log(`Created user ${user!.email} (${user!.id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create user:", err);
  process.exit(1);
});
