import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";
import * as readline from "readline";

// OTF Cognito constants — from otf_api/auth/auth.py lines 33-35
const CLIENT_ID = "1457d19r0pcjgmp5agooi0rb1b";
const USER_POOL_ID = "us-east-1_dYDxUeyL1";

// In-memory storage adapter (required for Node.js — without it, device tracking
// silently skips and cognitoUser.deviceKey will be null/undefined, causing the
// Worker's REFRESH_TOKEN_AUTH calls to fail with NotAuthorizedException).
const storage = new Map<string, string>();
const customStorage = {
  setItem(key: string, value: string) { storage.set(key, value); },
  getItem(key: string): string | null { return storage.get(key) ?? null; },
  removeItem(key: string) { storage.delete(key); },
  clear() { storage.clear(); },
};

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hidden) {
      process.stdout.write(question);
      process.stdin.setRawMode?.(true);
      let input = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (ch: string) => {
        if (ch === "\n" || ch === "\r" || ch === "\u0003") {
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (ch === "\u007F") {
          input = input.slice(0, -1);
        } else {
          input += ch;
          process.stdout.write("*");
        }
      });
    } else {
      rl.question(question, answer => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  console.log("\nOTF Bootstrap — captures refresh_token + device_key from a real OTF account.");
  console.log("Your password is never stored or transmitted beyond Cognito.\n");

  const email = await prompt("OTF email: ");
  const password = await prompt("OTF password: ", true);

  const poolData = {
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
    Storage: customStorage as unknown as Storage,
  };

  const userPool = new CognitoUserPool(poolData);
  const userData = {
    Username: email,
    Pool: userPool,
    Storage: customStorage as unknown as Storage,
  };
  const cognitoUser = new CognitoUser(userData);
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  await new Promise<void>((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess(_session) {
        // amazon-cognito-identity-js calls ConfirmDevice automatically in
        // authenticateUserDeviceFlow before firing onSuccess. After this callback,
        // cognitoUser.deviceKey should be populated.

        // Scan storage for tokens — the key uses the Cognito username (member UUID for OTF),
        // not the email address we authenticated with.
        let refreshToken: string | undefined;
        let deviceKey: string | undefined;

        for (const [key, value] of storage.entries()) {
          if (key.endsWith(".refreshToken")) refreshToken = value;
          if (key.endsWith(".deviceKey")) deviceKey = value;
        }

        // Fallback: try private property on cognitoUser if not in storage
        if (!deviceKey) {
          deviceKey = (cognitoUser as unknown as { deviceKey?: string }).deviceKey;
        }

        // Debug: log storage key names (not values) to help diagnose if assertion fails
        const storageKeys = [...storage.keys()];
        console.log(`\nStorage keys after auth: ${storageKeys.join(", ")}`);

        // ASSERTION: fail loudly if device tracking didn't complete
        if (!deviceKey) {
          console.error(
            "\nERROR: Device tracking didn't complete — deviceKey is null/undefined.\n" +
            "This means ConfirmDevice was not called, which will cause the Worker's\n" +
            "REFRESH_TOKEN_AUTH to fail with NotAuthorizedException.\n" +
            "Check that the custom storage adapter is wired up correctly and that\n" +
            "amazon-cognito-identity-js version >= 6.x is installed.\n",
          );
          process.exit(1);
        }

        if (!refreshToken) {
          console.error("\nERROR: refreshToken not found in storage after auth.\n");
          process.exit(1);
        }

        console.log("\n✓ Authentication successful.\n");
        console.log("─── Values to store as Cloudflare secrets ──────────────────────────────────\n");
        console.log(`OTF_REFRESH_TOKEN=${refreshToken}`);
        console.log(`OTF_DEVICE_KEY=${deviceKey}`);
        console.log("\n─── Run these commands (paste values when prompted) ─────────────────────────\n");
        console.log("pnpm exec wrangler secret put OTF_REFRESH_TOKEN");
        console.log("pnpm exec wrangler secret put OTF_DEVICE_KEY");
        console.log("pnpm exec wrangler secret put MCP_PATH_SECRET");
        console.log("\n(For MCP_PATH_SECRET, generate with: openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')");
        console.log("\nNOTE: Each bootstrap run registers a new device with Cognito.\n" +
          "If you re-bootstrap multiple times, old device registrations accumulate\n" +
          "on your account but are harmless.\n");
        resolve();
      },
      onFailure(err) {
        reject(err);
      },
      newPasswordRequired(_userAttributes, _requiredAttributes) {
        reject(new Error("Account requires password reset — log in to the OTF app first."));
      },
      mfaRequired(_challengeName, _challengeParameters) {
        reject(new Error("MFA challenge received — OTF doesn't use MFA, this is unexpected."));
      },
    });
  });
}

main().catch(err => {
  console.error("\nBootstrap failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
