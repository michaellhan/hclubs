/**
 * Sending the site's forms without leaving the site. The contribution form is a Google Form
 * (ADR 0035); its prefill link already carries every answer, so the same answers can be
 * posted to the form's own response endpoint from the page. Responses land in the same
 * sheet the importer reads, and visitors never see Google Forms.
 */

export interface FormPost {
  action: string;
  body: URLSearchParams;
}

/**
 * The response endpoint and answers behind a filled Google Form prefill link
 * (".../viewform?usp=pp_url&entry.N=…"), or null when the link isn't one. PURE.
 */
export function formPost(prefillUrl: string): FormPost | null {
  let u: URL;
  try {
    u = new URL(prefillUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  if (!/^\/forms\/d\/e\/[\w-]+\/viewform$/.test(u.pathname)) return null;
  const body = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (/^entry\.\d+$/.test(k) && v.trim()) body.append(k, v);
  if (body.size === 0) return null;
  return { action: `${u.origin}${u.pathname.replace(/\/viewform$/, "/formResponse")}`, body };
}

/**
 * Post the answers. Google's endpoint sends no CORS headers, so the reply can't be read:
 * a completed request counts as sent, a network error (offline, blocked) as not sent.
 */
export async function sendForm(prefillUrl: string): Promise<boolean> {
  const post = formPost(prefillUrl);
  if (!post) return false;
  try {
    await fetch(post.action, { method: "POST", mode: "no-cors", body: post.body });
    return true;
  } catch {
    return false;
  }
}
