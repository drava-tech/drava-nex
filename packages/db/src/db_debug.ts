import { db } from "./client.js";
import { screen } from "./schema/screens.js";
import { experience } from "./schema/projects.js";

async function run() {
  console.log("--- SCREENS ---");
  const screens = await db.select().from(screen);
  console.log(JSON.stringify(screens, null, 2));

  console.log("--- EXPERIENCES ---");
  const experiences = await db.select().from(experience);
  console.log(JSON.stringify(experiences, null, 2));
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
