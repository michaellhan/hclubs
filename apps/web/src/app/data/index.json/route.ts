import { buildTimeIndex } from "@/lib/static-index";

// Written once at build time to /data/index.json: the directory, search, and recruiting
// board all run in the browser from this file.
export const dynamic = "force-static";

export async function GET() {
  return Response.json(await buildTimeIndex());
}
