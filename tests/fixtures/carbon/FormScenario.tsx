import {
  Button,
  TextInput,
  Select,
  SelectItem,
  Checkbox,
  Toggle,
  Form,
  Stack,
} from "@carbon/react";

export function FormScenario() {
  return (
    <Form>
      <Stack gap={6}>
        <TextInput
          id="name"
          labelText="Full name"
          placeholder="Jane Smith"
        />
        <TextInput
          id="email"
          labelText="Email address"
          placeholder="jane@example.com"
          type="email"
        />
        <Select id="role" labelText="Role">
          <SelectItem value="" text="Choose a role" />
          <SelectItem value="designer" text="Designer" />
          <SelectItem value="engineer" text="Engineer" />
          <SelectItem value="pm" text="Product manager" />
        </Select>
        <Checkbox id="notifications" labelText="Send me email notifications" />
        <Toggle id="dark-mode" labelText="Dark mode" labelA="Off" labelB="On" />
        <Button type="submit">Save changes</Button>
      </Stack>
    </Form>
  );
}
