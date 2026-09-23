import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { HttpError } from "./attempts.js";
export const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : fileURLToPath(new URL("../uploads/tools", import.meta.url));
// Immutable assets keep logos in historical snapshots readable after edits/deletions.
// Replace this adapter with object storage without changing tool CRUD.
export const logoStorage = {
  async save(file: Express.Multer.File): Promise<string> {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype))
      throw new HttpError(400, "Upload a PNG, JPEG, or WebP image.");
    let bytes: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 20_000_000 });
      const info = await image.metadata();
      const expected = {
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/webp": "webp",
      }[file.mimetype];
      if (info.format !== expected) throw new Error("Mismatched image");
      bytes = await image
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .webp()
        .toBuffer();
    } catch {
      throw new HttpError(
        400,
        "The file is not a valid PNG, JPEG, or WebP image (maximum 20 megapixels).",
      );
    }
    await mkdir(uploadRoot, { recursive: true });
    const name = `${randomUUID()}.webp`;
    await writeFile(path.join(uploadRoot, name), bytes);
    return `/uploads/tools/${name}`;
  },
};
