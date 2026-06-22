import {
  InlineNotification,
  ToastNotification,
  ActionableNotification,
  Stack,
} from "@carbon/react";

export function NotificationScenario() {
  return (
    <Stack gap={5}>
      <InlineNotification
        kind="info"
        title="Design system update"
        subtitle="Carbon v11.71 is now available."
      />
      <InlineNotification
        kind="success"
        title="Analysis complete"
        subtitle="94 components scanned, 3 detached instances found."
      />
      <InlineNotification
        kind="warning"
        title="Drift detected"
        subtitle="8 instances of Button appear to be detached from the library."
      />
      <InlineNotification
        kind="error"
        title="Scan failed"
        subtitle="Unable to reach the library. Check your Figma permissions."
      />
      <ActionableNotification
        kind="warning"
        title="Outdated library"
        subtitle="Your library is 3 versions behind."
        actionButtonLabel="Update now"
        onActionButtonClick={() => {}}
      />
      <ToastNotification
        kind="success"
        title="Report exported"
        subtitle="coverage-report-2026-05.csv"
        caption="Just now"
      />
    </Stack>
  );
}
