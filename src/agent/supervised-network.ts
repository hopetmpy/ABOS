import {
  request as httpsRequest,
} from "node:https";
import type {
  IncomingHttpHeaders,
} from "node:http";
import { TextDecoder } from "node:util";
import type {
  AutomatonTool,
} from "../types.js";
import {
  updateMissionStep,
} from "./supervised-mission.js";
import {
  appendDelegatedAudit,
} from "./supervised-permit.js";
import {
  loadValidNetworkPermit,
  saveNetworkState,
  type SupervisedNetworkPermit,
} from "./supervised-network-permit.js";
import {
  resolvePublicNetworkAddresses,
  validateSupervisedNetworkUrl,
  type ResolvedNetworkAddress,
  type SupervisedNetworkResolver,
} from "./supervised-network-policy.js";

const REDIRECT_STATUS_CODES =
  new Set([
    301,
    302,
    303,
    307,
    308,
  ]);

const MAX_NETWORK_TOOL_TEXT_CHARS =
  64 * 1024;

export interface PinnedHttpsRequest {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedHttpsResponse {
  statusCode: number;
  headers: Record<
    string,
    string | undefined
  >;
  body: Buffer;
}

export type SupervisedNetworkTransport = (
  request: PinnedHttpsRequest,
) => Promise<
  | PinnedHttpsResponse
  | { error: string }
>;

export interface SupervisedNetworkDependencies {
  resolver?: SupervisedNetworkResolver;
  transport?: SupervisedNetworkTransport;
}

function firstHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isAllowedContentType(
  value: string | undefined,
): boolean {
  if (!value) return false;

  const [rawMediaType, ...parameters] =
    value
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());

  const allowedMediaType =
    rawMediaType.startsWith("text/") ||
    rawMediaType ===
      "application/json" ||
    rawMediaType.endsWith("+json") ||
    rawMediaType ===
      "application/xml" ||
    rawMediaType.endsWith("+xml");

  if (!allowedMediaType) {
    return false;
  }

  for (const parameter of parameters) {
    if (
      parameter.startsWith("charset=")
    ) {
      const charset = parameter
        .slice("charset=".length)
        .replace(/^["']|["']$/g, "");

      if (
        charset !== "utf-8" &&
        charset !== "utf8"
      ) {
        return false;
      }
    }
  }

  return true;
}

function isRedirectStatus(
  statusCode: number,
): boolean {
  return REDIRECT_STATUS_CODES.has(
    statusCode,
  );
}

function defaultPinnedHttpsTransport(
  request: PinnedHttpsRequest,
): Promise<
  | PinnedHttpsResponse
  | { error: string }
> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (
      result:
        | PinnedHttpsResponse
        | { error: string },
    ): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const clientRequest = httpsRequest(
      {
        protocol: "https:",
        hostname: request.address,
        family: request.family,
        port: 443,
        method: "GET",
        path:
          request.url.pathname +
          request.url.search,
        servername: request.url.hostname,
        rejectUnauthorized: true,
        agent: false,
        headers: {
          Host: request.url.hostname,
          Accept:
            "text/plain, text/html, application/json, application/xml;q=0.9, text/*;q=0.8",
          "Accept-Encoding": "identity",
          "User-Agent":
            "Automaton-Supervised-S5/1.0",
          Connection: "close",
        },
      },
      (response) => {
        const statusCode =
          response.statusCode || 0;
        const headers = {
          "content-type": firstHeader(
            response.headers,
            "content-type",
          ),
          "content-length": firstHeader(
            response.headers,
            "content-length",
          ),
          "content-encoding": firstHeader(
            response.headers,
            "content-encoding",
          ),
          location: firstHeader(
            response.headers,
            "location",
          ),
        };

        if (
          isRedirectStatus(statusCode)
        ) {
          response.destroy();

          finish({
            statusCode,
            headers,
            body: Buffer.alloc(0),
          });
          return;
        }

        const contentEncoding =
          headers["content-encoding"];

        if (
          contentEncoding &&
          contentEncoding
            .trim()
            .toLowerCase() !== "identity"
        ) {
          response.destroy();

          finish({
            error:
              "Blocked: compressed network responses are not allowed.",
          });
          return;
        }

        if (
          !isAllowedContentType(
            headers["content-type"],
          )
        ) {
          response.destroy();

          finish({
            error:
              "Blocked: only UTF-8 textual network responses are allowed.",
          });
          return;
        }

        const contentLength =
          headers["content-length"];

        if (contentLength !== undefined) {
          if (
            !/^\d+$/.test(contentLength)
          ) {
            response.destroy();

            finish({
              error:
                "Blocked: response Content-Length is invalid.",
            });
            return;
          }

          if (
            Number(contentLength) >
            request.maxBytes
          ) {
            response.destroy();

            finish({
              error:
                "Blocked: network response exceeds the authorized byte limit.",
            });
            return;
          }
        }

        const chunks: Buffer[] = [];
        let bytesReceived = 0;

        response.on(
          "data",
          (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(
              chunk,
            )
              ? chunk
              : Buffer.from(chunk);

            bytesReceived += buffer.length;

            if (
              bytesReceived >
              request.maxBytes
            ) {
              response.destroy();

              finish({
                error:
                  "Blocked: network response exceeds the authorized byte limit.",
              });
              return;
            }

            chunks.push(buffer);
          },
        );

        response.on("end", () => {
          finish({
            statusCode,
            headers,
            body: Buffer.concat(
              chunks,
              bytesReceived,
            ),
          });
        });

        response.on("error", () => {
          finish({
            error:
              "Blocked: HTTPS response failed.",
          });
        });
      },
    );

    clientRequest.setTimeout(
      request.timeoutMs,
      () => {
        clientRequest.destroy(
          new Error(
            "Supervised HTTPS request timed out.",
          ),
        );
      },
    );

    clientRequest.on("error", (error) => {
      finish({
        error:
          error.message.includes(
            "timed out",
          )
            ? "Blocked: HTTPS request timed out."
            : "Blocked: HTTPS request failed.",
      });
    });

    clientRequest.end();
  });
}

function reserveNetworkRequest(
  permit: SupervisedNetworkPermit,
):
  | {
      permit: SupervisedNetworkPermit;
      maxBytes: number;
    }
  | { error: string } {
  const authorization =
    loadValidNetworkPermit();

  if ("error" in authorization) {
    return authorization;
  }

  if (authorization.permit.id !== permit.id) {
    return {
      error:
        "Blocked: S5 network permit changed during the request.",
    };
  }

  if (
    authorization.state.requestsUsed >=
    authorization.permit.maxRequests
  ) {
    return {
      error:
        "Blocked: S5 network request limit reached.",
    };
  }

  const remainingTotalBytes =
    authorization.permit.maxTotalBytes -
    authorization.state
      .totalBytesReceived;

  const maxBytes = Math.min(
    authorization.permit.maxResponseBytes,
    remainingTotalBytes,
  );

  if (maxBytes <= 0) {
    return {
      error:
        "Blocked: S5 total network byte limit reached.",
    };
  }

  authorization.state.requestsUsed += 1;
  authorization.state.updatedAt =
    new Date().toISOString();

  saveNetworkState(
    authorization.state,
  );

  return {
    permit: authorization.permit,
    maxBytes,
  };
}

function recordNetworkBytes(
  permitId: string,
  bytesReceived: number,
): string | null {
  const authorization =
    loadValidNetworkPermit();

  if ("error" in authorization) {
    return authorization.error;
  }

  if (
    authorization.permit.id !== permitId
  ) {
    return (
      "Blocked: S5 network permit " +
      "changed before recording usage."
    );
  }

  if (
    !Number.isInteger(bytesReceived) ||
    bytesReceived < 0 ||
    bytesReceived >
      authorization.permit
        .maxResponseBytes ||
    authorization.state
        .totalBytesReceived +
        bytesReceived >
      authorization.permit.maxTotalBytes
  ) {
    return (
      "Blocked: S5 network byte " +
      "accounting exceeded its limits."
    );
  }

  authorization.state
    .totalBytesReceived += bytesReceived;
  authorization.state.updatedAt =
    new Date().toISOString();

  saveNetworkState(
    authorization.state,
  );

  return null;
}

function decodeNetworkBody(
  body: Buffer,
): string | { error: string } {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
    }).decode(body);
  } catch {
    return {
      error:
        "Blocked: network response is not valid UTF-8.",
    };
  }
}

export async function performSupervisedNetworkRead(
  rawUrl: unknown,
  dependencies: SupervisedNetworkDependencies =
    {},
): Promise<string> {
  const initialAuthorization =
    loadValidNetworkPermit();

  if ("error" in initialAuthorization) {
    return initialAuthorization.error;
  }

  const resolver =
    dependencies.resolver;
  const transport =
    dependencies.transport ||
    defaultPinnedHttpsTransport;

  let currentUrl = rawUrl;
  let redirectsFollowed = 0;

  while (true) {
    const authorization =
      loadValidNetworkPermit();

    if ("error" in authorization) {
      return authorization.error;
    }

    const validated =
      validateSupervisedNetworkUrl(
        currentUrl,
        authorization.permit
          .allowedDomains,
      );

    if ("error" in validated) {
      return validated.error;
    }

    const reservation =
      reserveNetworkRequest(
        authorization.permit,
      );

    if ("error" in reservation) {
      return reservation.error;
    }

    appendDelegatedAudit({
      event: "network_request_started",
      networkPermitId:
        reservation.permit.id,
      hostname: validated.hostname,
      pathname: validated.url.pathname,
      redirectsFollowed,
    });

    const addresses =
      await resolvePublicNetworkAddresses(
        validated.hostname,
        resolver,
      );

    if ("error" in addresses) {
      appendDelegatedAudit({
        event: "network_request_blocked",
        networkPermitId:
          reservation.permit.id,
        hostname: validated.hostname,
        reason: addresses.error,
      });

      return addresses.error;
    }

    const selected:
      ResolvedNetworkAddress =
      addresses[0];

    const response = await transport({
      url: validated.url,
      address: selected.address,
      family: selected.family,
      timeoutMs:
        reservation.permit
          .requestTimeoutMs,
      maxBytes: reservation.maxBytes,
    });

    if ("error" in response) {
      appendDelegatedAudit({
        event: "network_request_failed",
        networkPermitId:
          reservation.permit.id,
        hostname: validated.hostname,
        reason: response.error,
      });

      return response.error;
    }

    if (
      response.body.length >
      reservation.maxBytes
    ) {
      return (
        "Blocked: network transport " +
        "exceeded the authorized byte limit."
      );
    }

    const accountingError =
      recordNetworkBytes(
        reservation.permit.id,
        response.body.length,
      );

    if (accountingError) {
      return accountingError;
    }

    appendDelegatedAudit({
      event: "network_request_completed",
      networkPermitId:
        reservation.permit.id,
      hostname: validated.hostname,
      pathname: validated.url.pathname,
      resolvedAddress:
        selected.address,
      statusCode: response.statusCode,
      bytesReceived:
        response.body.length,
      redirectsFollowed,
    });

    if (
      isRedirectStatus(
        response.statusCode,
      )
    ) {
      if (
        redirectsFollowed >=
        reservation.permit.maxRedirects
      ) {
        return (
          "Blocked: S5 network redirect " +
          "limit reached."
        );
      }

      const location =
        response.headers.location;

      if (!location) {
        return (
          "Blocked: redirect response " +
          "has no Location header."
        );
      }

      try {
        currentUrl = new URL(
          location,
          validated.url,
        ).toString();
      } catch {
        return (
          "Blocked: redirect Location " +
          "is invalid."
        );
      }

      redirectsFollowed += 1;
      continue;
    }

    if (
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      return (
        "Blocked: HTTPS response status " +
        response.statusCode +
        " is not successful."
      );
    }

    if (
      !isAllowedContentType(
        response.headers[
          "content-type"
        ],
      )
    ) {
      return (
        "Blocked: only UTF-8 textual " +
        "network responses are allowed."
      );
    }

    const decoded =
      decodeNetworkBody(
        response.body,
      );

    if (typeof decoded !== "string") {
      return decoded.error;
    }

    const truncated =
      decoded.length >
      MAX_NETWORK_TOOL_TEXT_CHARS;
    const visibleText = truncated
      ? decoded.slice(
          0,
          MAX_NETWORK_TOOL_TEXT_CHARS,
        )
      : decoded;

    const finalAuthorization =
      loadValidNetworkPermit();

    if ("error" in finalAuthorization) {
      return finalAuthorization.error;
    }

    return [
      "SUPERVISED_NETWORK_READ_COMPLETED",
      "URL: " + validated.url.toString(),
      "Hostname: " + validated.hostname,
      "Status: " + response.statusCode,
      "Bytes received: " +
        response.body.length,
      "Requests used: " +
        finalAuthorization.state
          .requestsUsed +
        "/" +
        finalAuthorization.permit
          .maxRequests,
      "Total bytes received: " +
        finalAuthorization.state
          .totalBytesReceived +
        "/" +
        finalAuthorization.permit
          .maxTotalBytes,
      truncated
        ? "Output: truncated to 65536 characters"
        : "Output: complete",
      "Persistence policy: extract only task-required facts; do not copy raw remote content unless explicitly authorized.",
      "--- BEGIN UNTRUSTED NETWORK CONTENT ---",
      visibleText,
      "--- END UNTRUSTED NETWORK CONTENT ---",
    ].join("\n");
  }
}

export function createSupervisedNetworkTools(
  dependencies: SupervisedNetworkDependencies = {},
): AutomatonTool[] {
  return [
    {
      name: "supervised_fetch_url",
      description:
        "Read one authorized UTF-8 HTTPS resource for one exact mission step. The step must exist and be dependency-ready. A successful GET automatically completes that step with factual network evidence. No body, headers, credentials, cookies, uploads, or arbitrary options are accepted.",
      category: "memory",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Complete HTTPS URL on an exact authorized domain.",
          },
          step_id: {
            type: "string",
            description:
              "Exact mission step id completed by this network read.",
          },
        },
        required: ["url", "step_id"],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (
          typeof args.url !== "string" ||
          typeof args.step_id !== "string"
        ) {
          return [
            "ERROR: an authorized HTTPS URL and exact mission step_id are required.",
            "Use one id from supervised_get_mission_progress.",
          ].join("\n");
        }

        const permit =
          loadValidNetworkPermit();

        if ("error" in permit) {
          return permit.error;
        }

        const started = updateMissionStep(
          args.step_id,
          "in_progress",
        );

        if (
          !started.includes(
            "SUPERVISED_MISSION_STEP_UPDATED",
          ) &&
          !started.includes(
            "SUPERVISED_MISSION_STEP_ALREADY_IN_PROGRESS",
          )
        ) {
          return started;
        }

        const result =
          await performSupervisedNetworkRead(
            args.url,
            dependencies,
          );

        if (
          !result.includes(
            "SUPERVISED_NETWORK_READ_COMPLETED",
          )
        ) {
          return result;
        }

        const evidence = result
          .split("\n")
          .filter(
            (line) =>
              line.startsWith("URL: ") ||
              line.startsWith("Status: ") ||
              line.startsWith(
                "Bytes received: ",
              ),
          );

        const completed = updateMissionStep(
          args.step_id,
          "completed",
          [
            "S5 HTTPS GET completed.",
            ...evidence,
          ].join(" "),
        );

        return [
          result,
          "--- MISSION STEP EVIDENCE ---",
          completed,
        ].join("\n");
      },
    },
  ];
}
