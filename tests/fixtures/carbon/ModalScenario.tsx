import { useState } from "react";
import {
  Button,
  Modal,
  TextInput,
  Stack,
} from "@carbon/react";

export function ModalScenario() {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap={4} orientation="horizontal">
      <Button onClick={() => setOpen(true)}>Open modal</Button>

      <Modal
        open={open}
        modalHeading="Export coverage report"
        primaryButtonText="Export"
        secondaryButtonText="Cancel"
        onRequestSubmit={() => setOpen(false)}
        onRequestClose={() => setOpen(false)}
      >
        <Stack gap={5}>
          <p>
            Export a CSV of all scanned components including live count, detach
            count, and adoption percentage.
          </p>
          <TextInput
            id="filename"
            labelText="File name"
            defaultValue="coverage-report-2026-05"
          />
        </Stack>
      </Modal>
    </Stack>
  );
}
