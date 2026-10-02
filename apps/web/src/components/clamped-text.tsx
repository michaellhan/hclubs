/** Past this many characters a description is clamped behind "Read more". */
export const CLAMP_THRESHOLD = 450;

/**
 * Long text clamped to about four lines with "Read more". The whole text is in the HTML and
 * the toggle is a CSS checkbox, so it works without JavaScript.
 */
export function ClampedText({ id, text, className }: { id: string; text: string; className?: string }) {
  if (text.length <= CLAMP_THRESHOLD) return <p className={className}>{text}</p>;
  return (
    <div>
      <input id={id} type="checkbox" className="peer sr-only" aria-label="Show the full description" />
      <p className={`${className ?? ""} line-clamp-4 peer-checked:line-clamp-none`}>{text}</p>
      <label
        htmlFor={id}
        className="mt-1 inline-flex min-h-11 cursor-pointer items-center peer-checked:[&>span:first-child]:hidden peer-checked:[&>span:last-child]:inline text-sm text-accent underline-offset-2 hover:underline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent sm:min-h-9"
      >
        <span>Read more</span>
        <span className="hidden">Show less</span>
      </label>
    </div>
  );
}
