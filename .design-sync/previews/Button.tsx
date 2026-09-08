import { Button } from "xcs-gen-web";
import { Download, Play, Plus, Trash2 } from "lucide-react";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary">Generate .xcs</Button>
      <Button variant="secondary">Add pass</Button>
      <Button variant="ghost">Reset</Button>
      <Button variant="destructive">Delete test</Button>
      <Button variant="link">View changelog</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm">Add pass</Button>
      <Button variant="primary" size="md">Generate .xcs</Button>
      <Button variant="primary" size="lg">Burn test sheet</Button>
    </div>
  );
}

export function WithIcon() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary">
        <Play className="h-4 w-4" />
        Run sweep
      </Button>
      <Button variant="secondary" size="sm">
        <Plus className="h-3.5 w-3.5" />
        Add pass
      </Button>
      <Button variant="ghost" size="sm">
        <Download className="h-3.5 w-3.5" />
        Export G-code
      </Button>
      <Button variant="destructive" size="sm">
        <Trash2 className="h-3.5 w-3.5" />
        Discard
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled>Generate .xcs</Button>
      <Button variant="secondary" disabled>Add pass</Button>
      <Button variant="destructive" disabled>Delete test</Button>
    </div>
  );
}
