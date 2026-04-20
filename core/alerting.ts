/**
 * Alerting Channel
 * ================
 * Unified alert egress supporting webhook (DingTalk/Slack/Teams) and email.
 */

import { logger } from "./logger.ts";

export interface AlertPayload {
  level: "info" | "warning" | "critical";
  title: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AlertChannel {
  send(payload: AlertPayload): Promise<void>;
}

class WebhookAlertChannel implements AlertChannel {
  private url: string;
  private type: "generic" | "dingtalk" | "slack";

  constructor(url: string, type: "generic" | "dingtalk" | "slack" = "generic") {
    this.url = url;
    this.type = type;
  }

  async send(payload: AlertPayload): Promise<void> {
    const body = this.buildBody(payload);
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Webhook alert failed: ${res.status} ${res.statusText}`);
    }
  }

  private buildBody(payload: AlertPayload): Record<string, unknown> {
    if (this.type === "dingtalk") {
      return {
        msgtype: "markdown",
        markdown: {
          title: payload.title,
          text: `**${payload.title}**\n\n${payload.message}\n\n> Level: ${payload.level}\n> Time: ${new Date().toISOString()}`,
        },
      };
    }
    if (this.type === "slack") {
      return {
        text: `*${payload.title}*\n${payload.message}`,
        attachments: [
          {
            color: payload.level === "critical" ? "danger" : payload.level === "warning" ? "warning" : "good",
            fields: [
              { title: "Level", value: payload.level, short: true },
              { title: "Time", value: new Date().toISOString(), short: true },
            ],
          },
        ],
      };
    }
    return {
      level: payload.level,
      title: payload.title,
      message: payload.message,
      meta: payload.meta,
      timestamp: Date.now(),
    };
  }
}

const channels: AlertChannel[] = [];

function initChannels(): void {
  if (channels.length > 0) return;
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    const type = (process.env.ALERT_WEBHOOK_TYPE as "generic" | "dingtalk" | "slack") || "generic";
    channels.push(new WebhookAlertChannel(webhookUrl, type));
  }
}

export function resetAlertChannels(): void {
  channels.length = 0;
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  initChannels();
  if (channels.length === 0) {
    logger.info("No alert channel configured, logging locally", { title: payload.title, level: payload.level });
    return;
  }
  await Promise.all(
    channels.map((ch) =>
      ch.send(payload).catch((e) => {
        logger.error("Alert channel failed", { error: String(e), title: payload.title });
      })
    )
  );
}
