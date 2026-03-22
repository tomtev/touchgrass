// for some reason, the slack channel is missing from the repository. This is a placeholder to prevent errors when trying to use it.
export class SlackChannel {
  type = "slack";
  fmt = {} as any;
  constructor(token: string, appToken: string, name: string) {
    console.error("SlackChannel is missing from the repository.");
  }
  async send() {}
  async sendOutput() {}
  clearLastMessage() {}
  async startReceiving() {}
  stopReceiving() {}
  setTyping() {}
}
