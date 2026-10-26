import { describe, expect, it } from "vitest";
import {
  MAX_SPOKEN_NAME_CHARS,
  addressee,
  arrivalText,
  cleanName,
  dayKey,
  genericText,
  hourInTimezone,
  isReturning,
  joinNames,
  partOfDay,
  renameText,
  spokenName,
} from "../src/services/greeting/text.js";

const IST = "Asia/Kolkata";
const rules = { timezone: IST, afternoonHour: 12, eveningHour: 17, maxNames: 4 };
// IST is UTC+5:30, so 06:30Z is 12:00 IST.
const at = (iso: string) => new Date(iso);

describe("dayKey — the one place a day is derived", () => {
  it("rolls over at midnight in the greeting timezone, not the server's (UTC)", () => {
    expect(dayKey(at("2026-10-24T18:29:59Z"), IST)).toBe("2026-10-24"); // 23:59:59 IST
    expect(dayKey(at("2026-10-24T18:30:00Z"), IST)).toBe("2026-10-25"); // 00:00:00 IST
    expect(dayKey(at("2026-10-24T18:31:00Z"), IST)).toBe("2026-10-25"); // 00:01 IST
  });

  it("honours another timezone", () => {
    expect(dayKey(at("2026-10-24T03:00:00Z"), "America/New_York")).toBe("2026-10-23"); // 23:00 the day before
    expect(dayKey(at("2026-10-24T03:00:00Z"), "Asia/Tokyo")).toBe("2026-10-24");
  });

  it("is zero-padded", () => {
    expect(dayKey(at("2026-01-05T06:00:00Z"), IST)).toBe("2026-01-05");
  });
});

describe("hourInTimezone", () => {
  it("never reports 24: midnight is hour 0", () => {
    expect(hourInTimezone(at("2026-10-24T18:30:00Z"), IST)).toBe(0);
    expect(hourInTimezone(at("2026-10-24T18:45:00Z"), IST)).toBe(0);
  });
});

describe("partOfDay", () => {
  it.each([
    ["2026-10-24T18:30:00Z", "Good morning"], // 00:00 IST
    ["2026-10-24T06:29:00Z", "Good morning"], // 11:59
    ["2026-10-24T06:30:00Z", "Good afternoon"], // 12:00
    ["2026-10-24T11:29:00Z", "Good afternoon"], // 16:59
    ["2026-10-24T11:30:00Z", "Good evening"], // 17:00
    ["2026-10-24T18:29:00Z", "Good evening"], // 23:59
  ])("%s -> %s", (iso, expected) => {
    expect(partOfDay(at(iso), rules)).toBe(expected);
  });

  it("uses the configured hours", () => {
    const late = { ...rules, afternoonHour: 13, eveningHour: 19 };
    expect(partOfDay(at("2026-10-24T07:00:00Z"), late)).toBe("Good morning"); // 12:30
    expect(partOfDay(at("2026-10-24T07:30:00Z"), late)).toBe("Good afternoon"); // 13:00
    expect(partOfDay(at("2026-10-24T13:30:00Z"), late)).toBe("Good evening"); // 19:00
  });
});

describe("isReturning", () => {
  const now = at("2026-10-24T09:00:00Z"); // 14:30 IST on the 24th

  it("is true for a first_seen on an earlier local day", () => {
    expect(isReturning(at("2026-10-23T18:29:00Z"), now, IST)).toBe(true); // 23:59 IST on the 23rd
    expect(isReturning(at("2026-10-01T00:00:00Z"), now, IST)).toBe(true);
  });

  it("is false for a first_seen earlier TODAY, even though it is a different UTC day", () => {
    expect(isReturning(at("2026-10-23T18:30:00Z"), now, IST)).toBe(false); // 00:00 IST on the 24th
    expect(isReturning(at("2026-10-23T20:00:00Z"), now, IST)).toBe(false); // 01:30 IST on the 24th
    expect(isReturning(at("2026-10-24T08:00:00Z"), now, IST)).toBe(false);
  });
});

describe("joining names", () => {
  it("1, 2, 3 and 4 names", () => {
    expect(joinNames(["Priya"])).toBe("Priya");
    expect(joinNames(["Priya", "Arjun"])).toBe("Priya and Arjun");
    expect(joinNames(["Priya", "Arjun", "Meera"])).toBe("Priya, Arjun and Meera");
    expect(joinNames(["A", "B", "C", "D"])).toBe("A, B, C and D");
  });

  it("more than the maximum becomes 'everyone'", () => {
    expect(addressee(["A", "B", "C", "D"], { maxNames: 4 })).toBe("A, B, C and D");
    expect(addressee(["A", "B", "C", "D", "E"], { maxNames: 4 })).toBe("everyone");
    expect(addressee(["A", "B"], { maxNames: 1 })).toBe("everyone");
  });
});

describe("greeting lines", () => {
  const now = at("2026-10-24T09:00:00Z"); // afternoon

  it("'Welcome back.' only when EVERY named visitor is returning", () => {
    expect(arrivalText([{ name: "Priya", returning: true }], now, rules)).toBe("Good afternoon, Priya. Welcome back.");
    expect(
      arrivalText([{ name: "Priya", returning: true }, { name: "Arjun", returning: true }], now, rules)
    ).toBe("Good afternoon, Priya and Arjun. Welcome back.");
    expect(
      arrivalText([{ name: "Priya", returning: true }, { name: "Arjun", returning: false }], now, rules)
    ).toBe("Good afternoon, Priya and Arjun. Welcome.");
    expect(arrivalText([{ name: "Arjun", returning: false }], now, rules)).toBe("Good afternoon, Arjun. Welcome.");
  });

  it("a group over the limit gets the collective line, always plain 'Welcome.'", () => {
    const five = ["A", "B", "C", "D", "E"].map((name) => ({ name, returning: true }));
    expect(arrivalText(five, now, rules)).toBe("Good afternoon, everyone. Welcome.");
  });

  it("rename, and the nameless forms", () => {
    expect(renameText(["Priya"], now, rules)).toBe("Good afternoon, Priya. Nice to meet you.");
    expect(renameText(["Priya", "Arjun", "Meera"], now, rules)).toBe("Good afternoon, Priya, Arjun and Meera. Nice to meet you.");
    expect(renameText([], now, rules)).toBe("Good afternoon. Nice to meet you.");
    expect(genericText(now, rules)).toBe("Good afternoon. Welcome.");
  });
});

describe("cleanName / spokenName", () => {
  it("strips control and format characters and collapses whitespace", () => {
    expect(cleanName("  Pri\u0007ya​ \n  Sharma\u0000 ")).toBe("Pri ya Sharma");
    expect(cleanName("\t\n ")).toBe("");
  });

  it.each(["unknown", "Unknown", "UNKNOWN.", "test", "Test", "tester", "guest", "visitor", "unnamed", "anonymous", "n/a", "NA", "none", "null", "undefined", "---", "Unknown-1a2b3c4d", "unknown 12"])(
    "%j is a placeholder",
    (raw) => {
      expect(cleanName(raw)).toBe("");
    }
  );

  it.each(["Priya", "Priya Test", "Testa", "Tester Singh", "Unknowna", "Guest Kumar", "Anita Visitor"])(
    "%j is a real name",
    (raw) => {
      expect(cleanName(raw)).toBe(raw);
    }
  );

  it("caps at 40 characters, counting characters and not UTF-16 units", () => {
    expect(MAX_SPOKEN_NAME_CHARS).toBe(40);
    expect(spokenName("A".repeat(100), "full")).toBe("A".repeat(40));
    expect(spokenName("😀".repeat(100), "full")).toBe("😀".repeat(40));
    expect(spokenName("A".repeat(40), "full")).toBe("A".repeat(40));
  });

  it("modes: full, first, none", () => {
    expect(spokenName("Priya Sharma", "full")).toBe("Priya Sharma");
    expect(spokenName("Priya Sharma", "first")).toBe("Priya");
    expect(spokenName("Priya Sharma", "none")).toBe("");
    expect(spokenName("", "full")).toBe("");
  });

  it("first mode refuses a placeholder first word", () => {
    expect(spokenName("Test Priya", "first")).toBe("");
    expect(spokenName("Guest Kumar", "first")).toBe("");
  });
});
