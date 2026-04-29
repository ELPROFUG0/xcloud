import { describe, it, expect } from "vitest";
import { base64UrlEncode, buildSigningPayload, getPublicKeyBase64Url } from "../src/auth.ts";

describe("auth", () => {
  describe("base64UrlEncode", () => {
    it("encodes buffer to base64url without padding", () => {
      const buf = Buffer.from("hello world");
      const encoded = base64UrlEncode(buf);
      expect(encoded).toBe("aGVsbG8gd29ybGQ");
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).not.toContain("=");
    });

    it("replaces + with - and / with _", () => {
      // Create buffer that produces + and / in base64
      const buf = Buffer.from([0xfb, 0xff, 0xfe]);
      const encoded = base64UrlEncode(buf);
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
    });
  });

  describe("buildSigningPayload", () => {
    it("builds v2 payload with pipe-separated fields", () => {
      const payload = buildSigningPayload({
        deviceId: "device123",
        clientId: "cli",
        clientMode: "cli",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        signedAtMs: 1234567890,
        token: "mytoken",
        nonce: "nonce-abc",
      });

      expect(payload).toBe(
        "v2|device123|cli|cli|operator|operator.read,operator.write|1234567890|mytoken|nonce-abc",
      );
    });

    it("handles empty scopes", () => {
      const payload = buildSigningPayload({
        deviceId: "d",
        clientId: "c",
        clientMode: "m",
        role: "r",
        scopes: [],
        signedAtMs: 0,
        token: "t",
        nonce: "n",
      });

      expect(payload).toBe("v2|d|c|m|r||0|t|n");
    });
  });

  describe("getPublicKeyBase64Url", () => {
    it("extracts raw public key from PEM and encodes as base64url", () => {
      const pem =
        "-----BEGIN PUBLIC KEY-----\n" +
        "MCowBQYDK2VwAyEAYMmvye9cH5VUqK5es/LITBdZYh7efBci7UtfT2w759U=\n" +
        "-----END PUBLIC KEY-----\n";

      const b64 = getPublicKeyBase64Url(pem);
      expect(b64).toBe("YMmvye9cH5VUqK5es_LITBdZYh7efBci7UtfT2w759U");
      expect(b64).toHaveLength(43); // 32 bytes -> 43 chars in base64url
    });
  });
});
