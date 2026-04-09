import {useEffect, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Markdown, MessageBubble} from "@spacedrive/ai";
import {CaretDown, File as FileIcon, GitBranch} from "@phosphor-icons/react";
import {api, type AttachmentMeta, type TimelineBranchRun, type TimelineItem, type WorkerListItem} from "@/api/client";
import {ToolCall, type ToolCallPair, tryParseJson, isErrorResult} from "@/components/ToolCall";
import {PortalWorkerCard} from "./PortalWorkerCard";
import clsx from "clsx";

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** User message bubble with attachments rendered inline at the top. */
function UserMessageWithAttachments({
	content,
	attachments,
	agentId,
}: {
	content: string;
	attachments: AttachmentMeta[];
	agentId: string;
}) {
	const images = attachments.filter((a) => a.mime_type.startsWith("image/"));
	const files = attachments.filter((a) => !a.mime_type.startsWith("image/"));

	return (
		<div className="group flex flex-col items-end py-2">
			<div className="max-w-[80%] overflow-hidden rounded-2xl bg-accent text-sm leading-6 text-white">
				{images.length > 0 && (
					<div className={clsx(images.length === 1 ? "" : "grid grid-cols-2 gap-px")}>
						{images.map((att) => (
							<a
								key={att.id}
								href={api.attachmentUrl(agentId, att.id)}
								target="_blank"
								rel="noopener noreferrer"
							>
								<img
									src={api.attachmentUrl(agentId, att.id)}
									alt={att.filename}
									className="max-h-72 w-full object-cover"
									loading="lazy"
								/>
							</a>
						))}
					</div>
				)}
				{files.length > 0 && (
					<div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
						{files.map((att) => (
							<a
								key={att.id}
								href={api.attachmentUrl(agentId, att.id, {download: true})}
								download={att.filename}
								className="flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-1 text-xs transition-colors hover:bg-white/30"
							>
								<FileIcon size={12} className="flex-shrink-0" />
								<span className="max-w-[160px] truncate">{att.filename}</span>
								<span className="opacity-70">{formatFileSize(att.size_bytes)}</span>
							</a>
						))}
					</div>
				)}
				{content && (
					<div
						className={clsx(
							"px-4 py-2 whitespace-pre-wrap break-words",
							(images.length > 0 || files.length > 0) && "pt-1.5",
						)}
					>
						{content}
					</div>
				)}
			</div>
		</div>
	);
}

/** Attachments shown below an assistant message, inline with the thread. */
function AssistantAttachments({
	agentId,
	attachments,
}: {
	agentId: string;
	attachments: AttachmentMeta[];
}) {
	if (attachments.length === 0) return null;

	const images = attachments.filter((a) => a.mime_type.startsWith("image/"));
	const files = attachments.filter((a) => !a.mime_type.startsWith("image/"));

	return (
		<div className="mt-2 flex flex-col gap-2">
			{images.length > 0 && (
				<div className={clsx("flex flex-wrap gap-2")}>
					{images.map((att) => (
						<a
							key={att.id}
							href={api.attachmentUrl(agentId, att.id)}
							target="_blank"
							rel="noopener noreferrer"
							className="block overflow-hidden rounded-lg"
						>
							<img
								src={api.attachmentUrl(agentId, att.id)}
								alt={att.filename}
								className="max-h-64 max-w-xs rounded-lg object-cover"
								loading="lazy"
							/>
						</a>
					))}
				</div>
			)}
			{files.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{files.map((att) => (
						<a
							key={att.id}
							href={api.attachmentUrl(agentId, att.id, {download: true})}
							download={att.filename}
							className="border-app-line bg-app-box hover:bg-app-box/80 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
						>
							<FileIcon size={16} className="text-ink-faint flex-shrink-0" />
							<div className="min-w-0">
								<div className="text-ink max-w-[200px] truncate">{att.filename}</div>
								<div className="text-ink-faint text-xs">{formatFileSize(att.size_bytes)}</div>
							</div>
						</a>
					))}
				</div>
			)}
		</div>
	);
}

interface PortalTimelineProps {
	agentId: string;
	conversationId: string;
	timeline: TimelineItem[];
	isTyping: boolean;
	sendCount: number;
}

function ThinkingIndicator() {
	return (
		<div className="flex items-center gap-1.5 py-1">
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:0.2s]" />
			<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:0.4s]" />
		</div>
	);
}

/** Synthesize a minimal WorkerListItem from a timeline item when the workers
 * list hasn't caught up yet. */
function synthesizeWorker(
	item: Extract<TimelineItem, {type: "worker_run"}>,
	channelId: string,
): WorkerListItem {
	return {
		id: item.id,
		task: item.task,
		status: item.status,
		started_at: item.started_at,
		completed_at: item.completed_at ?? null,
		channel_id: channelId,
		channel_name: null,
		has_transcript: true,
		worker_type: "builtin",
		tool_calls: 0,
		live_status: null,
		interactive: false,
		directory: null,
		opencode_port: null,
		opencode_session_id: null,
	};
}

function PortalBranchCard({item}: {item: TimelineBranchRun}) {
	const [expanded, setExpanded] = useState(false);
	const isRunning = !item.completed_at;

	return (
		<div className="group flex min-w-0 flex-col items-start">
			<div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-app-line/50 bg-app-box/30 backdrop-blur-sm">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-app-box/30"
				>
					<div className="mt-0.5 shrink-0">
						{isRunning ? (
							<div className="flex size-7 items-center justify-center rounded-full bg-accent/15 text-accent">
								<GitBranch className="size-4 animate-spin" weight="bold" />
							</div>
						) : (
							<div className="flex size-7 items-center justify-center rounded-full bg-accent/15 text-accent">
								<GitBranch className="size-4" weight="bold" />
							</div>
						)}
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<div className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-ink">
								{item.description}
							</div>
							<span
								className={clsx(
									"rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
									isRunning
										? "bg-accent/12 text-accent"
										: "bg-emerald-500/12 text-emerald-400",
								)}
							>
								{isRunning ? "thinking" : "done"}
							</span>
						</div>
					</div>
					{item.conclusion && (
						<CaretDown
							className={clsx(
								"mt-1 size-4 shrink-0 text-ink-faint transition-transform",
								expanded ? "rotate-180" : "",
							)}
							weight="bold"
						/>
					)}
				</button>
				{expanded && item.conclusion && (
					<div className="border-t border-app-line/30 px-4 py-3">
						<Markdown content={item.conclusion} className="text-xs text-ink-dull" />
					</div>
				)}
			</div>
		</div>
	);
}

export function PortalTimeline({
	agentId,
	conversationId,
	timeline,
	isTyping,
	sendCount,
}: PortalTimelineProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const previousLengthRef = useRef(0);

	// Fetch workers for this channel to resolve worker_run items.
	const workersQuery = useQuery({
		queryKey: ["portal-workers", agentId, conversationId],
		queryFn: () => api.workersList(agentId, {limit: 20}),
		enabled: Boolean(conversationId),
		refetchInterval: 2000,
	});

	// Filter workers for this conversation.
	const conversationWorkers = (workersQuery.data?.workers ?? []).filter(
		(w) => w.channel_id === conversationId,
	);
	const workerIds = new Set(conversationWorkers.map((w) => w.id));

	// Filter worker_run items to only those matching workers we've seen.
	// Messages and other item types always render.
	const visibleItems = timeline.filter((item) => {
		if (item.type !== "worker_run") return true;
		return workerIds.has(item.id);
	});

	// Smart auto-scroll: only when near bottom
	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		const previousLength = previousLengthRef.current;
		const currentLength = visibleItems.length;
		const distanceFromBottom =
			element.scrollHeight - element.scrollTop - element.clientHeight;
		const isNearBottom = distanceFromBottom < 160;
		const shouldAutoScroll =
			(currentLength > previousLength || isTyping) &&
			(previousLength === 0 || isNearBottom);

		if (shouldAutoScroll) {
			requestAnimationFrame(() => {
				element.scrollTo({top: element.scrollHeight, behavior: "auto"});
			});
		}

		previousLengthRef.current = currentLength;
	}, [visibleItems.length, isTyping]);

	// Always scroll to bottom when the user sends a message.
	useEffect(() => {
		if (sendCount === 0) return;
		const element = scrollRef.current;
		if (!element) return;
		requestAnimationFrame(() => {
			element.scrollTo({top: element.scrollHeight, behavior: "smooth"});
		});
	}, [sendCount]);

	const copyMessage = async (content: string) => {
		await navigator.clipboard.writeText(content);
	};

	return (
		<div ref={scrollRef} className="flex-1 overflow-x-hidden overflow-y-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6 pb-[180px]">
				{visibleItems.map((item) => {
					if (item.type === "message") {
						const attachments = item.attachments ?? [];
						if (item.role === "user" && attachments.length > 0) {
							return (
								<UserMessageWithAttachments
									key={item.id}
									content={item.content}
									attachments={attachments}
									agentId={agentId}
								/>
							);
						}
						return (
							<div key={item.id}>
								<MessageBubble
									content={item.content}
									isUser={item.role === "user"}
									onCopy={(content) => void copyMessage(content)}
								/>
								{attachments.length > 0 && (
									<AssistantAttachments agentId={agentId} attachments={attachments} />
								)}
							</div>
						);
					}
					if (item.type === "branch_run") {
						return (
							<div key={item.id} className="py-1">
								<PortalBranchCard item={item as TimelineBranchRun} />
							</div>
						);
					}
					if (item.type === "worker_run") {
						const worker =
							conversationWorkers.find((w) => w.id === item.id) ??
							synthesizeWorker(item, conversationId);
						return (
							<div key={item.id} className="py-2">
								<PortalWorkerCard agentId={agentId} worker={worker} />
							</div>
						);
					}
					if (item.type === "tool_call_run") {
						const parsedArgs = tryParseJson(item.args);
						const parsedResult = item.result ? tryParseJson(item.result) : null;
						const pair: ToolCallPair = {
							id: item.id,
							name: item.tool_name,
							argsRaw: item.args,
							args: parsedArgs,
							resultRaw: item.result ?? null,
							result: parsedResult,
							status: item.status === "running"
								? "running"
								: item.result && isErrorResult(item.result, parsedResult)
									? "error"
									: "completed",
						};
						return (
							<div key={item.id} className="py-1">
								<ToolCall pair={pair} />
							</div>
						);
					}
					return null;
				})}
				{isTyping && <ThinkingIndicator />}
			</div>
		</div>
	);
}
