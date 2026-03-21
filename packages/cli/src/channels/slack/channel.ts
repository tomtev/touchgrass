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
