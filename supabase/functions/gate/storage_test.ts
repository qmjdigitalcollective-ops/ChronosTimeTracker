// Run: deno test supabase/functions/gate/storage_test.ts
// Checks the screenshot <-> Storage helpers against a fake Storage client — the part of
// the gate where a bug would silently lose screenshots or hand out broken image links.
(Deno as any).serve = () => {}; // importing index.ts must not start a server
const { moveScreenshotImagesToStorage, signScreenshotUrls, deleteExpiredScreenshots } = await import("./index.ts");

function fakeAdmin(opts: { failUpload?: boolean; bucketMissing?: boolean } = {}) {
  const uploads: string[] = [];
  let bucketExists = !opts.bucketMissing;
  const admin = {
    storage: {
      createBucket: async () => { bucketExists = true; return { error: null }; },
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (opts.failUpload) return { error: { message: "boom" } };
          if (!bucketExists) return { error: { message: "Bucket not found" } };
          uploads.push(`${path}:${bytes.length}`);
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/storage/v1/object/sign/screenshots/${encodeURIComponent(p)}?token=t` })),
        }),
      }),
    },
  };
  return { admin, uploads };
}

const b64 = btoa("hello"); // 5 bytes
const row = () => ({ id: "ss_1", employee_id: "emp-1", image_data_url: `data:image/webp;base64,${b64}`, thumbnail_data_url: `data:image/jpeg;base64,${b64}` });
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

Deno.test("base64 images move to Storage and the row keeps only paths", async () => {
  const { admin, uploads } = fakeAdmin();
  const r = row();
  await moveScreenshotImagesToStorage(admin, r);
  eq(r.image_data_url, "storage:emp-1/ss_1.webp");
  eq(r.thumbnail_data_url, "storage:emp-1/ss_1_thumb.jpg");
  eq(uploads, ["emp-1/ss_1.webp:5", "emp-1/ss_1_thumb.jpg:5"]);
});

Deno.test("first upload creates the bucket and retries", async () => {
  const { admin, uploads } = fakeAdmin({ bucketMissing: true });
  const r = row();
  await moveScreenshotImagesToStorage(admin, r);
  eq(r.image_data_url, "storage:emp-1/ss_1.webp");
  eq(uploads.length, 2);
});

Deno.test("a failed upload keeps the base64 — the screenshot is never lost", async () => {
  const { admin } = fakeAdmin({ failUpload: true });
  const r = row();
  await moveScreenshotImagesToStorage(admin, r);
  eq(r.image_data_url, row().image_data_url);
});

Deno.test("reads get signed URLs; saving one back stores the path again", async () => {
  const { admin } = fakeAdmin();
  const r: Record<string, any> = { id: "ss_1", employee_id: "emp-1", image_data_url: "storage:emp-1/ss_1.webp", thumbnail_data_url: "data:image/jpeg;base64,OLD" };
  await signScreenshotUrls(admin, [r]);
  if (!r.image_data_url.startsWith("https://")) throw new Error("not signed: " + r.image_data_url);
  eq(r.thumbnail_data_url, "data:image/jpeg;base64,OLD"); // older base64 rows pass through untouched
  await moveScreenshotImagesToStorage(admin, r);
  eq(r.image_data_url, "storage:emp-1/ss_1.webp");
});

// ── 30-day cleanup, against a tiny in-memory "screenshots" table ──────────────
const DAY = 24 * 3600 * 1000;
function fakeDb(rows: Record<string, any>[], opts: { failRemove?: boolean } = {}) {
  const removed: string[] = [];
  const isStored = (v: unknown) => typeof v === "string" && v.startsWith("storage:");
  const query = (mode: "select" | "delete") => {
    let preds: ((r: any) => boolean)[] = [];
    let lim = Infinity;
    const q: any = {
      lt: (c: string, v: number) => (preds.push((r) => r[c] < v), q),
      or: () => (preds.push((r) => isStored(r.image_data_url) || isStored(r.thumbnail_data_url)), q),
      not: (c: string) => (preds.push((r) => !isStored(r[c])), q),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
      limit: (n: number) => ((lim = n), q),
      then: (res: any) => {
        const hit = rows.filter((r) => preds.every((p) => p(r))).slice(0, lim);
        if (mode === "delete") for (const h of hit) rows.splice(rows.indexOf(h), 1);
        return Promise.resolve({ data: mode === "select" ? hit : null, error: null }).then(res);
      },
    };
    return q;
  };
  const admin = {
    from: () => ({ select: () => query("select"), delete: () => query("delete") }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => (opts.failRemove ? { error: { message: "boom" } } : (removed.push(...paths), { error: null })),
      }),
    },
  };
  return { admin, rows, removed };
}
const shot = (id: string, ageDays: number, stored: boolean) => ({
  id,
  timestamp: Date.now() - ageDays * DAY,
  image_data_url: stored ? `storage:e/${id}.webp` : "data:image/jpeg;base64,AAA",
  thumbnail_data_url: stored ? `storage:e/${id}_thumb.webp` : null,
});

Deno.test("cleanup deletes only screenshots older than 30 days, files and rows", async () => {
  const { admin, rows, removed } = fakeDb([shot("old1", 31, true), shot("old2", 45, false), shot("new1", 29, true), shot("new2", 1, false)]);
  await deleteExpiredScreenshots(admin);
  eq(rows.map((r) => r.id), ["new1", "new2"]);
  eq(removed, ["e/old1.webp", "e/old1_thumb.webp"]);
});

Deno.test("if Storage files can't be removed, their rows are kept for the next run", async () => {
  const { admin, rows } = fakeDb([shot("old1", 31, true), shot("new1", 1, true)], { failRemove: true });
  await deleteExpiredScreenshots(admin);
  eq(rows.map((r) => r.id), ["old1", "new1"]);
});

Deno.test("a big backlog is cleared in batches of 200, never stranding Storage files", async () => {
  const many = Array.from({ length: 450 }, (_, i) => shot(`s${i}`, 40, true));
  const { admin, rows, removed } = fakeDb([...many, shot("inline", 40, false)]);
  await deleteExpiredScreenshots(admin);
  eq(rows.length, 251); // 200 deleted; the inline one waits until Storage rows are caught up
  await deleteExpiredScreenshots(admin);
  await deleteExpiredScreenshots(admin);
  eq(rows.length, 0);
  eq(removed.length, 900);
});
