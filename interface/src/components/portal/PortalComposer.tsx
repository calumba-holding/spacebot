import { ChatComposer, type ModelOption } from "@spacedrive/ai";
import { usePopover } from "@spacedrive/primitives";

interface PortalComposerProps {
	agentName: string;
	draft: string;
	onDraftChange: (value: string) => void;
	onSend: () => void;
	disabled: boolean;
	modelOptions: ModelOption[];
	selectedModel: string;
	onSelectModel: (model: string) => void;
	projectOptions: string[];
	selectedProject: string;
	onSelectProject: (project: string) => void;
}

/**
 * Portal chat composer — wraps @spacedrive/ai's ChatComposer with spacebot
 * project + model selectors and a per-agent placeholder.
 */
export function PortalComposer({
	agentName,
	draft,
	onDraftChange,
	onSend,
	disabled,
	modelOptions,
	selectedModel,
	onSelectModel,
	projectOptions,
	selectedProject,
	onSelectProject,
}: PortalComposerProps) {
	const projectPopover = usePopover();

	return (
		<ChatComposer
			draft={draft}
			onDraftChange={onDraftChange}
			onSend={onSend}
			placeholder={disabled ? "Waiting for response..." : `Message ${agentName}...`}
			isSending={disabled}
			projectSelector={
				projectOptions.length > 0
					? {
							value: selectedProject,
							options: projectOptions,
							onChange: onSelectProject,
							popover: projectPopover,
						}
					: undefined
			}
			modelSelector={
				modelOptions.length > 0
					? {
							value: selectedModel,
							options: modelOptions,
							onChange: onSelectModel,
						}
					: undefined
			}
		/>
	);
}
