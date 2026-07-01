import { auth } from "./lib/auth";
import { db } from "@platform/db";
import * as schema from "@platform/db";
import { eq } from "drizzle-orm";

async function seed() {
  const email = "digital@thewhitetusker.com";
  const password = "Digital@1331";
  const name = "The White Tusker Digital";

  try {
    console.log(`Creating user: ${email}...`);

    // 1. Create user using Better Auth (this correctly hashes the password)
    const res = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
      },
    });

    if (res && res.user) {
      console.log("User created! Upgrading role to SUPERADMIN...");

      // 2. Use Drizzle to update the role to SUPERADMIN since input is disabled in auth config
      await db.update(schema.user).set({ role: "SUPERADMIN" }).where(eq(schema.user.email, email));

      console.log("\n✅ Admin user created successfully!");
      console.log("-----------------------------------------");
      console.log(`Email:    ${email}`);
      console.log(`Password: ${password}`);
      console.log("-----------------------------------------");
      console.log("You can now log in using these credentials.");
    } else {
      console.log("Failed to create user. It may already exist.");
      // Try to update it anyway just in case
      await db.update(schema.user).set({ role: "SUPERADMIN" }).where(eq(schema.user.email, email));
      console.log("Updated existing user to SUPERADMIN role.");
    }
  } catch (error) {
    console.error("Error creating admin user:", error);
  }
}

seed().then(() => process.exit(0)).catch(() => process.exit(1));
