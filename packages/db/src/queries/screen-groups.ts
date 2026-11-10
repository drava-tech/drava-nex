import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../client.js";
import { screen, screenGroup } from "../schema/screens.js";

/**
 * Screen groups: named sets of screens the CMS lists together. Membership is
 * screen.groupId, so a screen is in at most one group.
 */

export interface ScreenGroupRow {
  id: string;
  name: string;
}

/** All groups, in their display order (then oldest first). */
export async function listScreenGroups(): Promise<ScreenGroupRow[]> {
  return db
    .select({ id: screenGroup.id, name: screenGroup.name })
    .from(screenGroup)
    .orderBy(asc(screenGroup.position), asc(screenGroup.createdAt));
}

export async function screenGroupExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: screenGroup.id })
    .from(screenGroup)
    .where(eq(screenGroup.id, id))
    .limit(1);
  return Boolean(row);
}

/** Case-insensitive, so "Lobby" and "lobby" can't both exist. `exceptId` skips the group being renamed. */
export async function screenGroupNameExists(name: string, exceptId?: string): Promise<boolean> {
  const sameName = sql`lower(${screenGroup.name}) = lower(${name})`;
  const [row] = await db
    .select({ id: screenGroup.id })
    .from(screenGroup)
    .where(exceptId ? and(sameName, sql`${screenGroup.id} <> ${exceptId}`) : sameName)
    .limit(1);
  return Boolean(row);
}

/** New groups go to the end of the list. */
export async function createScreenGroup(name: string): Promise<ScreenGroupRow> {
  const [row] = await db
    .insert(screenGroup)
    .values({
      name,
      position: sql`coalesce((select max(${screenGroup.position}) + 1 from ${screenGroup}), 0)`,
    })
    .returning({ id: screenGroup.id, name: screenGroup.name });
  if (!row) throw new Error("Failed to create screen group");
  return row;
}

export async function renameScreenGroup(id: string, name: string): Promise<void> {
  await db.update(screenGroup).set({ name }).where(eq(screenGroup.id, id));
}

/** Delete a group; its screens become ungrouped (screen.group_id ON DELETE SET NULL). */
export async function deleteScreenGroup(id: string): Promise<void> {
  await db.delete(screenGroup).where(eq(screenGroup.id, id));
}

/**
 * Make `screenIds` exactly the screens in group `id`: the listed ones move in
 * (out of whatever group they were in), the group's other screens become
 * ungrouped. Soft-deleted screens are left alone.
 */
export async function setScreenGroupMembers(id: string, screenIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(screen)
      .set({ groupId: null, updatedAt: new Date() })
      .where(
        screenIds.length > 0
          ? and(eq(screen.groupId, id), notInArray(screen.screenId, screenIds))
          : eq(screen.groupId, id)
      );
    if (screenIds.length > 0) {
      await tx
        .update(screen)
        .set({ groupId: id, updatedAt: new Date() })
        .where(and(inArray(screen.screenId, screenIds), isNull(screen.deletedAt)));
    }
  });
}

/** Move one screen into a group, or out of any group with null. */
export async function setScreenGroup(screenId: string, groupId: string | null): Promise<void> {
  await db
    .update(screen)
    .set({ groupId, updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}
