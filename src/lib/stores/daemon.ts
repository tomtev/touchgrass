import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// --- Types ---

export interface ChannelSummary {
  name: string;
  channel_type: string;
  botUsername: string | null;
  botFirstName: string | null;
  pairedUserCount: number;
  linkedGroupCount: number;
}

export interface PairedUser {
  userId: string;
  username: string | null;
  pairedAt: string | null;
}

export interface LinkedGroup {
  chatId: string;
  title: string | null;
  linkedAt: string | null;
}

export interface ChannelDetails {
  name: string;
  channel_type: string;
  botUsername: string | null;
  pairedUsers: PairedUser[];
  linkedGroups: LinkedGroup[];
}

export interface RuntimeChannel {
  chatId: string;
  title: string;
  type: string;
  busy: boolean;
  busyLabel: string | null;
}

// --- Stores ---

export const daemonStatus = writable<'unknown' | 'running' | 'stopped'>('unknown');
export const channels = writable<ChannelSummary[]>([]);
export const runtimeChannels = writable<RuntimeChannel[]>([]);
export const selectedChannel = writable<ChannelDetails | null>(null);

// --- Functions ---

export async function checkDaemonHealth(): Promise<boolean> {
  try {
    await invoke('daemon_health');
    daemonStatus.set('running');
    return true;
  } catch {
    daemonStatus.set('stopped');
    return false;
  }
}

export async function loadChannels(): Promise<void> {
  const resp = await invoke<{ ok: boolean; channels: ChannelSummary[] }>(
    'daemon_list_channels'
  );
  channels.set(resp.channels);
}

export async function loadRuntimeChannels(): Promise<void> {
  const resp = await invoke<{ ok: boolean; channels: RuntimeChannel[] }>(
    'daemon_runtime_channels'
  );
  runtimeChannels.set(resp.channels);
}

export async function loadChannelDetails(name: string): Promise<ChannelDetails> {
  const resp = await invoke<{ ok: boolean; channel: ChannelDetails }>(
    'daemon_get_channel',
    { name }
  );
  selectedChannel.set(resp.channel);
  return resp.channel;
}

export async function addChannel(
  name: string,
  channelType: string,
  botToken: string
): Promise<{ botUsername: string | null; needsRestart: boolean }> {
  const resp = await invoke<{
    ok: boolean;
    botUsername: string | null;
    needsRestart: boolean | null;
  }>('daemon_add_channel', {
    name,
    channelType,
    botToken,
  });
  return {
    botUsername: resp.botUsername ?? null,
    needsRestart: resp.needsRestart ?? false,
  };
}

export async function removeChannel(name: string): Promise<{ needsRestart: boolean }> {
  const resp = await invoke<{ ok: boolean; needsRestart: boolean | null }>(
    'daemon_remove_channel',
    { name }
  );
  await loadChannels();
  return { needsRestart: resp.needsRestart ?? false };
}

export async function removeUser(channelName: string, userId: string): Promise<void> {
  await invoke('daemon_remove_user', { channelName, userId });
}

export async function removeGroup(channelName: string, chatId: string): Promise<void> {
  await invoke('daemon_remove_group', { channelName, chatId });
}

export async function generatePairingCode(): Promise<string> {
  const resp = await invoke<{ ok: boolean; code: string | null }>('daemon_generate_code');
  return resp.code ?? '';
}

export async function restartDaemon(): Promise<void> {
  daemonStatus.set('unknown');
  await invoke('daemon_restart');
  daemonStatus.set('running');
}
