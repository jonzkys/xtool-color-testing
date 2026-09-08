import { Button, Card, EmptyState } from "xcs-gen-web";
import { Camera, FileSearch2, Layers, Plus } from "lucide-react";

export function NoResultsYet() {
  return (
    <Card padded={false} className="max-w-[520px]">
      <EmptyState
        icon={<Camera className="h-5 w-5" />}
        title="No results yet"
        description="Burn the test and photograph the sheet, then upload the image. Fiducial markers align it automatically."
      />
    </Card>
  );
}

export function WithAction() {
  return (
    <Card padded={false} className="max-w-[520px]">
      <EmptyState
        title="No materials yet"
        description="Palette entries have to be tagged with a material so queries stay scoped. Add a material on the Library tab first, then burn a test and upload the result."
        action={<Button variant="primary">Open library</Button>}
      />
    </Card>
  );
}

export function WithIconAndAction() {
  return (
    <Card padded={false} className="max-w-[520px]">
      <EmptyState
        icon={<FileSearch2 className="h-6 w-6" />}
        title="No file loaded"
        description="Drop a Studio .gc export here, or click below to browse. Files are parsed locally — nothing is uploaded."
        action={
          <Button variant="secondary" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Choose .gc file
          </Button>
        }
      />
    </Card>
  );
}

export function SelectALayer() {
  return (
    <Card padded={false} className="max-w-[520px]">
      <EmptyState
        icon={<Layers className="h-6 w-6" />}
        title="Select a layer"
        description="Pick one from the Layers list on the left to edit its params, processing, or crosshatch."
      />
    </Card>
  );
}
