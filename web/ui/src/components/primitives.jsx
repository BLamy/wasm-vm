import { useId } from "react";
// Small compositions of library controls with the site's defaults. Product surfaces import these
// (or the library directly) — never hand-built lookalikes.
import {
  List,
  Switch,
  Segmented,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  TextField,
  Label,
  Input,
  FieldDescription,
  buttonVariants,
} from "@brett_lamy/ui";

// A list row that is a link. The library renders `title`/`subtitle` inside a pointer-events:none
// body (pressable rows are its own overlay <button>), so a link there cannot be clicked. Row
// `children` are its live control area, and its row gestures already ignore `a[href]`; the anchor
// goes there, stretched over the row body, with the library's own title/subtitle typography.
// The link's name is the title alone; the detail line is its description.
export function LinkRow({ href, title, detail, current = false, rel, target, onNavigate }) {
  const id = useId();
  return (
    <List.Row accessory="chevron">
      <a
        className="wv-row-link"
        href={href}
        rel={rel}
        target={target}
        aria-current={current ? "page" : undefined}
        aria-labelledby={`${id}-title`}
        aria-describedby={detail ? `${id}-detail` : undefined}
        onClick={onNavigate}
      >
        <span id={`${id}-title`} className="wv-row-title truncate leading-[1.3]">{title}</span>
        {detail ? <span id={`${id}-detail`} className="wv-row-detail mt-px truncate text-footnote text-muted-foreground">{detail}</span> : null}
      </a>
    </List.Row>
  );
}

// An <a> that looks like the library Button. Navigation stays a link (new tab, copy link).
export function ButtonLink({ variant, size, className = "", ...props }) {
  return <a className={`${buttonVariants({ variant, size })} ${className}`.trim()} {...props} />;
}

// A labelled on/off setting as a list row; pressing the row toggles the switch.
export function SettingSwitch({ title, detail, checked, onChange }) {
  return <List.Row title={title} subtitle={detail} accessory={<Switch checked={checked} onChange={onChange} />} />;
}

// One-of-few choice. `options` is [{ id, label }].
export function Choice({ label, options, value, onChange }) {
  return <Segmented aria-label={label} options={options} value={value} onChange={onChange} />;
}

// One-of-many choice with a visible label. `options` is [{ id, label }].
export function Picker({ label, options, value, onChange, description }) {
  return (
    <Select value={value} onChange={(key) => onChange(String(key))}>
      <Label>{label}</Label>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <SelectContent items={options}>{(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}</SelectContent>
    </Select>
  );
}

// Labelled text input with optional help text.
export function Field({ label, description, ...props }) {
  return (
    <TextField {...props}>
      <Label>{label}</Label>
      <Input />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </TextField>
  );
}
