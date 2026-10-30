import { START_ROUTE } from "../routes.js";
import { ButtonLink } from "./primitives.jsx";

export function NotFoundActions() {
  return (
    <div className="wv-home-actions">
      <ButtonLink href="./landing.html">Go to the homepage</ButtonLink>
      <ButtonLink variant="secondary" href="./docs.html">Search the docs</ButtonLink>
      <ButtonLink variant="ghost" href={START_ROUTE}>Start Linux</ButtonLink>
    </div>
  );
}
