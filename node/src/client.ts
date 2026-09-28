// Thin wrapper around TypeSafeClient. Keep this (and the TYPESAFE_API_KEY it
// reads) on the server; never import it into code that ships to a browser.
import "dotenv/config";
import { TypeSafeClient } from "@typesafe-ai/sdk";

let client: TypeSafeClient | undefined;

export function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient();
  }
  return client;
}
