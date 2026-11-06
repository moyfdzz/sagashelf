import { Form } from "react-router";

export const moderationPage = "/admin/moderation";

/**
 * A button that sends one action as a POST of its own and loads the page again. `fields` are the
 * hidden fields it carries besides the action: the id of a report or of an account, or the username
 * of the card it came from.
 */
export function ActionButton({
  intent,
  fields,
  className,
  children,
}: {
  intent: string;
  fields: Record<string, string>;
  className: string;
  children: string;
}) {
  return (
    <Form method="post" reloadDocument>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className}>
        {children}
      </button>
    </Form>
  );
}
