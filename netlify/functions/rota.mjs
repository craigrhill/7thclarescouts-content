// netlify/src/rota.mjs
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// node_modules/@netlify/blobs/dist/chunk-6TDSNTDP.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var DEPLOY_STORE_PREFIX = "deploy:";
var SITE_STORE_PREFIX = "site:";
var isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX);
var blobsErrorMessage = (res, context, responseBody) => {
  let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
  if (res.headers.has(NF_REQUEST_ID)) {
    details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
  }
  if (isDeniedWrite(res, context)) {
    const storeName = context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName;
    return `Netlify Blobs could not write to store '${storeName}' (${details}). Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
  }
  let message = `Netlify Blobs has generated an internal error (${details})`;
  if (!res.headers.get(NF_ERROR) && responseBody) {
    message += `: ${responseBody}`;
  }
  return message;
};
var BlobsInternalError = class extends Error {
  constructor(res, context = {}, responseBody) {
    super(blobsErrorMessage(res, context, responseBody));
    this.name = "BlobsInternalError";
    this.status = res.status;
    this.responseBody = responseBody;
  }
};
var createBlobsInternalError = async (res, context = {}) => {
  const responseBody = await res.clone().text().catch(() => void 0);
  return new BlobsInternalError(res, context, responseBody);
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch2, url, options, attemptsLeft = MAX_RETRY, getRetryUrl) => {
  try {
    const res = await fetch2(url, options);
    const isRetryable = res.status === 429 || res.status >= 500 || getRetryUrl !== void 0 && res.status === 403;
    if (attemptsLeft > 0 && isRetryable) {
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      const retryUrl = getRetryUrl ? await getRetryUrl() : url;
      return fetchAndRetry(fetch2, retryUrl, options, attemptsLeft - 1, getRetryUrl);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    const retryUrl = getRetryUrl ? await getRetryUrl() : url;
    return fetchAndRetry(fetch2, retryUrl, options, attemptsLeft - 1, getRetryUrl);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch: fetch2, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch2 ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers2 = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers2[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers: headers2,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw await createBlobsInternalError(res, { method, storeName });
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body: body2,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers2 = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers2["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers2["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers2["if-none-match"] = "*";
    }
    const options = {
      body: body2,
      headers: headers2,
      method
    };
    if (body2 instanceof ReadableStream) {
      options.duplex = "half";
    }
    const usesSignedUrl = !this.edgeURL && key !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete";
    let getRetryUrl;
    if (usesSignedUrl) {
      getRetryUrl = async () => {
        const finalRequest = await this.getFinalRequest({ consistency, key, metadata, method, parameters, storeName });
        return finalRequest.url;
      };
    }
    return fetchAndRetry(this.fetch, url, options, void 0, getRetryUrl);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// node_modules/@netlify/blobs/dist/main.js
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers2 = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers: headers2,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw await createBlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers2 = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        conditions,
        body: payload,
        headers: headers2,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const clientOptions = getClientOptions(input);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// netlify/src/rota.mjs
var STORE = "rota";
var CONTENT_STORE = "site-content";
var CONTENT_KEY = "content";
var CONTENT_FILE = "content.json";
var TOKEN_DAYS = 365;
var BUILT_IN_HASH = "e5aea01f131ba1b26c0c87bb21822cc93e73039466bf15f6cae3a1b77ac1235d";
var headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password, x-rota-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
var json = (status, body2) => new Response(JSON.stringify(body2), { status, headers });
var fail = (status, error) => json(status, { error });
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function adminOk(req) {
  const given = req.headers.get("x-admin-password") || "";
  const envPw = process.env.ADMIN_PASSWORD;
  return envPw ? safeEqual(given, envPw) : safeEqual(createHash("sha256").update(given).digest("hex"), BUILT_IN_HASH);
}
var gh = () => {
  const repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return null;
  const path = process.env.GITHUB_PATH || CONTENT_FILE;
  return { url: `https://api.github.com/repos/${repo}/contents/${path}`, token, branch: process.env.GITHUB_BRANCH || "main" };
};
var ghHeaders = (t) => ({ Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "7thclare-rota", "X-GitHub-Api-Version": "2022-11-28" });
async function ghRead(g) {
  const r = await fetch(`${g.url}?ref=${g.branch}&t=${Date.now()}`, { headers: ghHeaders(g.token) });
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content.replace(/\n/g, ""), "base64").toString("utf8")), sha: j.sha };
}
var CONFLICT = "conflict";
async function ghWrite(g, data, message, sha) {
  const body2 = { message, content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"), branch: g.branch };
  if (sha) body2.sha = sha;
  const r = await fetch(g.url, { method: "PUT", headers: { ...ghHeaders(g.token), "Content-Type": "application/json" }, body: JSON.stringify(body2) });
  if (r.status === 409 || r.status === 422) throw new Error(CONFLICT);
  if (!r.ok) throw new Error(`GitHub write failed: ${r.status}`);
}
async function readContent(storeFactory) {
  const g = gh();
  if (g) {
    const { data, sha } = await ghRead(g);
    if (data) return { doc: data, sha };
  }
  const doc = await storeFactory(CONTENT_STORE).get(CONTENT_KEY, { type: "json" });
  if (!doc) throw new Error("The group calendar is not set up yet.");
  return { doc, sha: null };
}
async function withContentEvents(storeFactory, fn) {
  const g = gh();
  for (let attempt = 0; ; attempt++) {
    const { doc, sha } = await readContent(storeFactory);
    const out = fn(doc);
    if (out.error || out.noop) return out;
    doc.events = out.events;
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    doc.updatedBy = "secretary";
    try {
      if (g) await ghWrite(g, doc, `Calendar update ${doc.updatedAt}`, sha);
      else await storeFactory(CONTENT_STORE).setJSON(CONTENT_KEY, doc);
      return out;
    } catch (e) {
      if (String(e.message) !== CONFLICT || attempt >= 2) throw e;
    }
  }
}
var COUNTY_FEED = process.env.COUNTY_FEED || "https://calendar.countyclarescouts.ie/api/events";
var countyFallback = () => ({ items: {}, syncedAt: null });
function countyTargets(ce, ourSections) {
  const named = (ce.sections || []).filter((s) => ourSections.includes(s));
  return named.length ? named : ourSections.slice();
}
function countyDecisions(it, targets) {
  if (it.decisions) return it.decisions;
  const d = {};
  if (it.status && it.status !== "pending") for (const k of targets) d[k] = { status: it.status, by: it.by || null, at: it.at || null };
  return d;
}
var countyStatus = (it, k, targets) => (countyDecisions(it, targets)[k] || {}).status || "pending";
var countyApproved = (it, targets) => targets.filter((k) => countyStatus(it, k, targets) === "approved");
function fromCounty(ce, section) {
  const e = { date: ce.start, title: oneLine(ce.name, 120) };
  if (ce.end && ce.end !== ce.start) e.endDate = ce.end;
  if (section) e.section = section;
  const location = oneLine(ce.location, 120);
  if (location) e.location = location;
  const time = oneLine(ce.time, 60);
  const [from, to] = readTimes(time);
  if (from) {
    e.startTime = from;
    if (to && (e.endDate || to > from)) e.endTime = to;
  } else if (time) e.time = time;
  const bits = [ce.description, ce.host ? "Hosted by " + ce.host : "", ce.link].filter(Boolean);
  if (bits.length) e.details = bits.join("\n\n").trim().slice(0, 2e3);
  e.countyId = ce.id;
  return e;
}
var entryKey = (e) => JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));
var sameEvents = (x, y) => x.length === y.length && x.map(entryKey).sort().join("\0") === y.map(entryKey).sort().join("\0");
var countyStamp = (ce) => JSON.stringify([ce.start, ce.end, ce.name, ce.time, ce.location, ce.description, ce.host, ce.link, (ce.sections || []).slice().sort()]);
var relevant = (ce, ourSections) => {
  const secs = ce.sections || [];
  return secs.length === 0 || secs.some((s) => ourSections.includes(s));
};
async function fetchCounty() {
  const r = await fetch(COUNTY_FEED + (COUNTY_FEED.includes("?") ? "&" : "?") + "t=" + Date.now(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("The county calendar did not answer (" + r.status + ").");
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.events;
  if (!Array.isArray(list)) throw new Error("The county calendar sent something unexpected.");
  return list.filter((e) => e && e.id && e.start && e.name);
}
async function readDoc(store, key, fallback) {
  const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  return r && r.data ? { doc: r.data, etag: r.etag } : { doc: fallback(), etag: null };
}
async function update(store, key, fallback, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, etag } = await readDoc(store, key, fallback);
    const next = fn(doc);
    if (next === false) return doc;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const r = await store.set(key, JSON.stringify(next), etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (r.modified !== false) return next;
  }
  throw new Error("Someone else saved at the same moment. Try again.");
}
var secrets = /* @__PURE__ */ new WeakMap();
async function secret(store) {
  if (secrets.has(store)) return secrets.get(store);
  const r = await store.getWithMetadata("secret", { type: "text", consistency: "strong" });
  let s = r && r.data;
  if (!s) {
    s = randomBytes(32).toString("hex");
    const w = await store.set("secret", s, { onlyIfNew: true });
    if (w.modified === false) s = (await store.getWithMetadata("secret", { type: "text", consistency: "strong" })).data;
  }
  secrets.set(store, s);
  return s;
}
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = randomBytes(8);
  let c = "";
  for (let i = 0; i < 8; i++) c += ALPHABET[b[i] & 31];
  return c.slice(0, 4) + "-" + c.slice(4);
}
var normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
var hmac = (sec, s, enc) => createHmac("sha256", Buffer.from(sec, "hex")).update(s).digest(enc);
var codeHash = (sec, code) => hmac(sec, normCode(code), "hex");
function issueToken(sec, id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString("base64url");
  return payload + "." + hmac(sec, payload, "base64url");
}
function readToken(sec, token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = hmac(sec, payload, "base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return j.id && j.exp > Date.now() ? j : null;
  } catch {
    return null;
  }
}
var rosterFallback = () => ({ people: [] });
var eventsFallback = () => ({ events: [] });
var eventKey = (e) => e.date + "|" + e.title;
var sameEvent = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
var isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
var oneLine = (v, n) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
function cleanEvent(b, sectionKeys, kitIds) {
  if (!isDate(b.date)) return { error: "A start date is needed." };
  const title = oneLine(b.title, 120);
  if (!title) return { error: "A title is needed." };
  const e = { date: b.date, title };
  if (b.endDate) {
    if (!isDate(b.endDate)) return { error: "That end date is not a date." };
    if (b.endDate < b.date) return { error: "The end date is before the start date." };
    e.endDate = b.endDate;
  }
  const section = oneLine(b.section, 32);
  if (section) {
    if (!sectionKeys.includes(section)) return { error: "Unknown section." };
    e.section = section;
  }
  const location = oneLine(b.location, 120);
  if (location) e.location = location;
  if (b.startTime) {
    if (!isTime(b.startTime)) return { error: "That start time is not a time." };
    e.startTime = b.startTime;
  }
  if (b.endTime) {
    if (!isTime(b.endTime)) return { error: "That end time is not a time." };
    if (!e.startTime) return { error: "An end time needs a start time." };
    if (!e.endDate && b.endTime <= e.startTime) return { error: "The end time is not after the start time." };
    e.endTime = b.endTime;
  }
  const time = oneLine(b.time, 60);
  if (time && !e.startTime) e.time = time;
  const kitId = oneLine(b.kitId, 32);
  if (kitId) {
    if (!kitIds.includes(kitId)) return { error: "Unknown kit list." };
    e.kitId = kitId;
  }
  const details = String(b.details ?? "").trim().slice(0, 2e3);
  if (details) e.details = details;
  return { event: e };
}
var isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
var TIME_RE = /(\d{1,2})[:.](\d{2})\s*(?:([ap])\.?m\.?)?|(\d{1,2})\s*([ap])\.?m\.?/gi;
function readTimes(text) {
  const out = [];
  for (const m of String(text || "").matchAll(TIME_RE)) {
    let h = +(m[1] ?? m[4]);
    const min = m[2] ? +m[2] : 0, mark = (m[3] || m[5] || "").toLowerCase();
    if (h > 23 || min > 59) continue;
    if (mark === "p") {
      if (h < 12) h += 12;
    } else if (mark === "a") {
      if (h === 12) h = 0;
    } else if (h < 13) continue;
    out.push(String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0"));
    if (out.length === 2) break;
  }
  return out;
}
var sectionFallback = () => ({ required: 2, slots: {} });
var canSeeSection = (me, canManage, k) => canManage || (me.sections || []).includes(k);
var SKILLS = ["camping", "backwoods", "pioneering", "hillwalking", "emergencies", "air", "paddling", "rowing", "sailing"];
var isSkill = (x) => SKILLS.includes(x);
var badgesFallback = () => ({ next: 1, youth: [], stages: {} });
var canSeeBoard = (me, canManage, k) => canManage || (me.sections || []).includes(k);
var canEditBoard = (me, canManage, k) => canSeeBoard(me, canManage, k) && (canManage || !!me.lead);
var byNumber = (youth) => [...youth].sort((x, y) => x.n - y.n);
var boardFor = (doc) => ({ next: doc.next, youth: byNumber(doc.youth), stages: doc.stages, updatedAt: doc.updatedAt || null });
var attendanceFallback = () => ({ meetings: {} });
var publicBoard = (k, doc) => ({ section: k, updatedAt: doc.updatedAt || null, rows: byNumber(doc.youth).map((y) => ({ n: y.n, stages: doc.stages[y.id] || {} })) });
var pub = (p, withCode) => ({ id: p.id, name: p.name, sections: p.sections || [], lead: !!p.lead, secretary: !!p.secretary, ...withCode ? { code: p.code || null } : {} });
var isKey = (k) => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k);
var isSlotId = (s) => typeof s === "string" && /^[me]:\d{4}-\d{2}-\d{2}(:.{1,140})?$/.test(s);
var cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 60);
var cleanSections = (a) => Array.isArray(a) ? [...new Set(a.filter(isKey))] : [];
async function body(req) {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}
function createHandler(storeFactory) {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const a = url.searchParams.get("a") || "";
    try {
      const store = storeFactory(STORE);
      const sec = await secret(store);
      if (req.method === "POST" && a === "bootstrap") {
        if (!adminOk(req)) return fail(401, "Wrong password.");
        const b2 = await body(req);
        const name = cleanName(b2 && b2.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode();
        let person;
        await update(store, "roster", rosterFallback, (doc) => {
          person = doc.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (person) {
            person.lead = true;
            person.secretary = true;
            person.code = code;
            person.codeHash = codeHash(sec, code);
          } else {
            person = { id: randomBytes(4).toString("hex"), name, sections: [], lead: true, secretary: true, code, codeHash: codeHash(sec, code), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
            doc.people.push(person);
          }
          return doc;
        });
        return json(200, { person: pub(person), code });
      }
      if (req.method === "POST" && a === "admin-login") {
        if (!adminOk(req)) return fail(401, "Wrong password.");
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.secretary);
        if (!person) return fail(409, "No secretary yet. Set one up on the roster page first.");
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }
      if (req.method === "POST" && a === "login") {
        const b2 = await body(req);
        const h = codeHash(sec, b2 && b2.code);
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.codeHash === h);
        if (!person || normCode(b2.code).length < 8) {
          await new Promise((r) => setTimeout(r, 250));
          return fail(401, "That code is not recognised.");
        }
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }
      if (req.method === "GET" && a === "board") {
        const k = url.searchParams.get("section") || "";
        if (!isKey(k)) return fail(400, "Bad section.");
        const { doc } = await readDoc(store, "badges/" + k, badgesFallback);
        return json(200, publicBoard(k, doc));
      }
      const t = readToken(sec, req.headers.get("x-rota-token"));
      if (!t) return fail(401, "Please sign in.");
      const roster = await readDoc(store, "roster", rosterFallback);
      const me = roster.doc.people.find((p) => p.id === t.id);
      if (!me) return fail(401, "Please sign in.");
      const hasSecretary = roster.doc.people.some((p) => p.secretary);
      const canManage = !!me.secretary || !hasSecretary && !!me.lead;
      if (req.method === "GET" && a === "badges") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey).filter((k) => canSeeBoard(me, canManage, k));
        const boards = {}, canEdit = {};
        for (const k of keys) {
          const { doc } = await readDoc(store, "badges/" + k, badgesFallback);
          boards[k] = boardFor(doc);
          canEdit[k] = canEditBoard(me, canManage, k);
        }
        return json(200, { me: pub(me, canManage), boards, canEdit });
      }
      if (req.method === "GET" && a === "attendance") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey).filter((k) => canSeeBoard(me, canManage, k));
        const sections = {}, canEdit = {}, canAdd = {};
        for (const k of keys) {
          const { doc: board } = await readDoc(store, "badges/" + k, badgesFallback);
          const { doc: att } = await readDoc(store, "attendance/" + k, attendanceFallback);
          sections[k] = { youth: byNumber(board.youth).map(({ id, n, name }) => ({ id, n, name })), meetings: att.meetings, updatedAt: att.updatedAt || null };
          canEdit[k] = true;
          canAdd[k] = canEditBoard(me, canManage, k);
        }
        return json(200, { me: pub(me, canManage), sections, canEdit, canAdd });
      }
      if (req.method === "GET") {
        const wanted = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey);
        const keys = wanted.filter((k) => canSeeSection(me, canManage, k));
        const sections = {};
        for (const k of keys) {
          const { doc } = await readDoc(store, "section/" + k, sectionFallback);
          sections[k] = { required: doc.required, slots: doc.slots, updatedAt: doc.updatedAt || null };
        }
        const mine = new Set(me.sections || []);
        const visible = me.lead || canManage ? roster.doc.people : roster.doc.people.filter((p) => p.id === me.id || (p.sections || []).some((k) => mine.has(k)));
        const { doc: ev } = await readDoc(store, "events", eventsFallback);
        const { doc: cd } = await readDoc(store, "county", countyFallback);
        const ourSections = new Set(wanted);
        const allKeys = [...ourSections];
        const county = !me.lead && !canManage ? [] : Object.entries(cd.items || {}).map(([id, it]) => {
          const targets = countyTargets(it.event, allKeys);
          const rows = (canManage ? targets : targets.filter((k) => mine.has(k))).map((k) => ({ section: k, status: countyStatus(it, k, targets), by: (countyDecisions(it, targets)[k] || {}).by || null }));
          return { id, changed: !!it.changed, gone: !!it.gone, event: it.event, targets, rows };
        }).filter((x) => x.rows.length);
        return json(200, { me: pub(me, canManage), people: visible.map((p) => pub(p, canManage)), sections, events: ev.events || [], county, countySyncedAt: cd.syncedAt || null });
      }
      if (req.method !== "POST") return fail(405, "Method not allowed.");
      if (a === "county-sync") {
        let content;
        try {
          content = (await readContent(storeFactory)).doc;
        } catch (e) {
          return fail(503, String(e.message || e));
        }
        const ourSections = (content.settings.sections || []).map((x) => x.key);
        let feed;
        try {
          feed = await fetchCounty();
        } catch (e) {
          return fail(502, String(e.message || e));
        }
        const seen = /* @__PURE__ */ new Set();
        let added = 0, changed = 0, gone = 0;
        const doc = await update(store, "county", countyFallback, (d) => {
          for (const ce of feed) {
            if (!relevant(ce, ourSections)) continue;
            seen.add(ce.id);
            const stamp = countyStamp(ce), was = d.items[ce.id];
            if (!was) {
              d.items[ce.id] = { status: "pending", stamp, event: ce, at: (/* @__PURE__ */ new Date()).toISOString() };
              added++;
            } else if (was.stamp !== stamp) {
              was.stamp = stamp;
              was.event = ce;
              was.changed = true;
              delete was.gone;
              changed++;
            }
          }
          for (const [id, it] of Object.entries(d.items)) {
            if (!seen.has(id) && !it.gone) {
              it.gone = true;
              gone++;
            } else if (seen.has(id) && it.gone) delete it.gone;
          }
          d.syncedAt = (/* @__PURE__ */ new Date()).toISOString();
          return d;
        });
        const want = new Map(Object.entries(doc.items).map(([id, it]) => [id, countyApproved(it, countyTargets(it.event, ourSections)).map((sk) => fromCounty(it.event, sk))]));
        const following = Object.entries(doc.items).filter(([id, it]) => it.changed && want.get(id).length);
        let repaired = 0;
        await withContentEvents(storeFactory, (cdoc) => {
          const keep = [], now = /* @__PURE__ */ new Map();
          for (const e of Array.isArray(cdoc.events) ? cdoc.events : []) {
            if (e.countyId && want.has(e.countyId)) {
              const arr = now.get(e.countyId) || [];
              arr.push(e);
              now.set(e.countyId, arr);
            } else keep.push(e);
          }
          const stale = new Set([...want.keys()].filter((id) => !sameEvents(now.get(id) || [], want.get(id))));
          if (!stale.size) return { noop: true };
          repaired = stale.size;
          for (const [id, arr] of now) if (!stale.has(id)) keep.push(...arr);
          for (const id of stale) keep.push(...want.get(id));
          keep.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
          return { events: keep };
        });
        if (following.length) await update(store, "county", countyFallback, (d) => {
          for (const [id] of following) if (d.items[id]) delete d.items[id].changed;
          return d;
        });
        return json(200, { added, changed, gone, followed: following.length, repaired, syncedAt: doc.syncedAt });
      }
      const b = await body(req);
      if (!b) return fail(400, "Body must be JSON.");
      if (a === "badge-add" || a === "badge-rename" || a === "badge-remove" || a === "badge-stage") {
        const k = b.section;
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!canSeeBoard(me, canManage, k)) return fail(403, "That section is not on your roster entry.");
        if (!canEditBoard(me, canManage, k)) return fail(403, "Only a section lead can change the board.");
        let problem = null;
        const doc = await update(store, "badges/" + k, badgesFallback, (d) => {
          if (a === "badge-add") {
            const names = String(b.name || "").split(",").map(cleanName).filter(Boolean);
            if (!names.length) {
              problem = "A name is needed.";
              return false;
            }
            for (const name of names) d.youth.push({ id: randomBytes(4).toString("hex"), n: d.next++, name, addedAt: (/* @__PURE__ */ new Date()).toISOString() });
            return d;
          }
          const y = d.youth.find((x) => x.id === b.id);
          if (!y) {
            problem = "Not on this board.";
            return false;
          }
          if (a === "badge-rename") {
            const name = cleanName(b.name);
            if (!name) {
              problem = "A name is needed.";
              return false;
            }
            y.name = name;
            return d;
          }
          if (a === "badge-remove") {
            d.youth = d.youth.filter((x) => x.id !== y.id);
            delete d.stages[y.id];
            return d;
          }
          if (!isSkill(b.skill)) {
            problem = "Unknown skill.";
            return false;
          }
          const st = Math.round(Number(b.stage));
          if (!(st >= 0 && st <= 9)) {
            problem = "Stage must be 0 to 9.";
            return false;
          }
          const row = d.stages[y.id] = d.stages[y.id] || {};
          if (st === 0) delete row[b.skill];
          else row[b.skill] = st;
          if (!Object.keys(row).length) delete d.stages[y.id];
          return d;
        });
        if (problem) return fail(400, problem);
        return json(200, { board: boardFor(doc) });
      }
      if (a === "attend" || a === "attend-remove") {
        const k = b.section;
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!canSeeBoard(me, canManage, k)) return fail(403, "That section is not on your roster entry.");
        if (!isDate(b.date)) return fail(400, "Bad date.");
        const { doc: board } = await readDoc(store, "badges/" + k, badgesFallback);
        const known = new Set(board.youth.map((y) => y.id));
        const doc = await update(store, "attendance/" + k, attendanceFallback, (d) => {
          if (a === "attend-remove") {
            delete d.meetings[b.date];
            return d;
          }
          const present = [...new Set((Array.isArray(b.present) ? b.present : []).filter((id) => known.has(id)))];
          const note = String(b.note || "").trim().slice(0, 80);
          d.meetings[b.date] = { present, note, by: me.name, at: (/* @__PURE__ */ new Date()).toISOString() };
          return d;
        });
        return json(200, { meetings: doc.meetings });
      }
      if (a === "slot") {
        if (!isKey(b.section) || !isSlotId(b.id)) return fail(400, "Bad section or slot.");
        if (!canSeeSection(me, canManage, b.section)) return fail(403, "That section is not on your roster entry.");
        const known = new Set(roster.doc.people.map((p) => p.id));
        const add = Array.isArray(b.add) ? b.add : [], remove = Array.isArray(b.remove) ? b.remove : [];
        if ([...add, ...remove].some((id) => !known.has(id))) return fail(400, "Unknown person.");
        if (!me.lead) {
          if ("off" in b || "need" in b) return fail(403, "Only a section lead can change that.");
          if ([...add, ...remove].some((id) => id !== me.id)) return fail(403, "You can only tick yourself.");
        }
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const s = d.slots[b.id] = d.slots[b.id] || { who: [], off: false };
          s.who = [.../* @__PURE__ */ new Set([...s.who.filter((id) => !remove.includes(id)), ...add])].filter((id) => known.has(id));
          if ("off" in b) s.off = !!b.off;
          if ("need" in b) {
            const n = Number(b.need);
            if (n >= 1 && n <= 9 && n !== d.required) s.need = Math.round(n);
            else delete s.need;
          }
          return d;
        });
        return json(200, { section: doc });
      }
      if (a === "required") {
        if (!me.lead) return fail(403, "Only a section lead can change that.");
        if (!isKey(b.section)) return fail(400, "Bad section.");
        if (!canSeeSection(me, canManage, b.section)) return fail(403, "That section is not on your roster entry.");
        const n = Math.round(Number(b.required));
        if (!(n >= 1 && n <= 9)) return fail(400, "Required must be 1 to 9.");
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          d.required = n;
          for (const s of Object.values(d.slots)) if (s.need === n) delete s.need;
          return d;
        });
        return json(200, { section: doc });
      }
      if (a === "county-decide") {
        const decision = String(b.decision || "");
        if (!["approve", "decline", "reset"].includes(decision)) return fail(400, "Unknown decision.");
        let content;
        try {
          content = (await readContent(storeFactory)).doc;
        } catch (e) {
          return fail(503, String(e.message || e));
        }
        const ourSections = (content.settings.sections || []).map((x) => x.key);
        const { doc: cdoc } = await readDoc(store, "county", countyFallback);
        const item = cdoc.items[b.id];
        if (!item) return fail(404, "No such county event.");
        const targets = countyTargets(item.event, ourSections);
        const k = String(b.section || "");
        if (!isKey(k)) return fail(400, "Bad section.");
        if (!targets.includes(k)) return fail(400, "The county has not offered that event to that section.");
        if (!(canManage || me.lead && (me.sections || []).includes(k))) return fail(403, "That is not one of your sections.");
        const status = decision === "reset" ? "pending" : decision === "approve" ? "approved" : "declined";
        const doc = await update(store, "county", countyFallback, (d) => {
          const it = d.items[b.id];
          if (!it) return false;
          it.decisions = countyDecisions(it, targets);
          if (status === "pending") delete it.decisions[k];
          else it.decisions[k] = { status, by: me.name, at: (/* @__PURE__ */ new Date()).toISOString() };
          delete it.status;
          delete it.by;
          delete it.changed;
          return d;
        });
        const approved = countyApproved(doc.items[b.id], targets);
        await withContentEvents(storeFactory, (cd2) => {
          const list = (Array.isArray(cd2.events) ? cd2.events : []).filter((e) => e.countyId !== b.id);
          for (const sk of approved) list.push(fromCounty(item.event, sk));
          list.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
          return { events: list };
        });
        return json(200, { id: b.id, section: k, status });
      }
      if (a === "event" || a === "event-update" || a === "event-remove") {
        const isPrivate = !!b.private;
        const mayEdit = (e) => !e.countyId && (canManage || !!me.lead && !!e.section && (me.sections || []).includes(e.section));
        const deny = (e) => e.countyId ? [403, "That came from the county. Change it on the County chip."] : e.section ? [403, "Only a lead of that section can change its events."] : [403, "Only the secretary can change whole-group events."];
        const apply = (list, content) => {
          const sectionKeys = (content && content.settings.sections || []).map((x) => x.key);
          const kitIds = (content && content.kits || []).map((k) => k.id);
          if (a === "event-remove") {
            const ex = list.find((e) => sameEvent(eventKey(e), b.key));
            if (!ex) return { error: [404, "No such event."] };
            if (!mayEdit(ex)) return { error: deny(ex) };
            return { events: list.filter((e) => e !== ex) };
          }
          const { event, error } = cleanEvent(b, sectionKeys, kitIds);
          if (error) return { error: [400, error] };
          const key = eventKey(event);
          const clash = (skip) => list.some((e, i2) => i2 !== skip && sameEvent(eventKey(e), key));
          if (!mayEdit(event)) return { error: deny(event) };
          if (a === "event") {
            if (clash(-1)) return { error: [409, "There is already an event with that date and title."] };
            return { events: [...list, event] };
          }
          const i = list.findIndex((e) => sameEvent(eventKey(e), b.key));
          if (i < 0) return { error: [404, "No such event."] };
          if (!mayEdit(list[i])) return { error: deny(list[i]) };
          if (clash(i)) return { error: [409, "There is already an event with that date and title."] };
          const next = [...list];
          next[i] = event;
          return { events: next };
        };
        const sort = (l) => l.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
        let out;
        if (isPrivate) {
          let content = null;
          try {
            content = (await readContent(storeFactory)).doc;
          } catch {
          }
          let err = null;
          const d = await update(store, "events", eventsFallback, (doc) => {
            const r2 = apply(doc.events || [], content);
            if (r2.error) {
              err = r2.error;
              return false;
            }
            doc.events = sort(r2.events);
            return doc;
          });
          if (err) return fail(err[0], err[1]);
          out = { events: d.events };
        } else {
          try {
            out = await withContentEvents(storeFactory, (doc) => {
              const r2 = apply(Array.isArray(doc.events) ? doc.events : [], doc);
              return r2.error ? r2 : { events: sort(r2.events) };
            });
          } catch (e) {
            return fail(503, String(e.message || e));
          }
          if (out.error) return fail(out.error[0], out.error[1]);
        }
        return json(200, { events: out.events, private: isPrivate });
      }
      if (!canManage) return fail(403, "Only the secretary can do that.");
      if (a === "person") {
        const name = cleanName(b.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode();
        let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = { id: randomBytes(4).toString("hex"), name, sections: cleanSections(b.sections), lead: !!b.lead, secretary: !!b.secretary, code, codeHash: codeHash(sec, code), createdAt: (/* @__PURE__ */ new Date()).toISOString() };
          d.people.push(person);
          return d;
        });
        if (!person) return fail(409, "Someone with that name is already on the list.");
        return json(200, { person: pub(person), code });
      }
      if (a === "person-update" || a === "person-remove" || a === "recode") {
        const target = roster.doc.people.find((p) => p.id === b.id);
        if (!target) return fail(404, "No such person.");
        const secretaries = roster.doc.people.filter((p) => p.secretary).length;
        const losingSecretary = target.secretary && (a === "person-remove" || a === "person-update" && "secretary" in b && !b.secretary);
        if (losingSecretary && secretaries <= 1) return fail(409, "Keep at least one secretary.");
        if (a === "recode") {
          const code = newCode();
          await update(store, "roster", rosterFallback, (d) => {
            const p = d.people.find((x) => x.id === b.id);
            if (!p) return false;
            p.code = code;
            p.codeHash = codeHash(sec, code);
            return d;
          });
          return json(200, { code });
        }
        if (a === "person-update") {
          let person;
          await update(store, "roster", rosterFallback, (d) => {
            person = d.people.find((x) => x.id === b.id);
            if (!person) return false;
            if ("name" in b) {
              const n = cleanName(b.name);
              if (n) person.name = n;
            }
            if ("sections" in b) person.sections = cleanSections(b.sections);
            if ("lead" in b) person.lead = !!b.lead;
            if ("secretary" in b) person.secretary = !!b.secretary;
            return d;
          });
          return json(200, { person: pub(person) });
        }
        const doc = await update(store, "roster", rosterFallback, (d) => {
          d.people = d.people.filter((x) => x.id !== b.id);
          return d;
        });
        for (const k of cleanSections(b.sections)) {
          await update(store, "section/" + k, sectionFallback, (d) => {
            let hit = false;
            for (const s of Object.values(d.slots)) {
              const n = s.who.length;
              s.who = s.who.filter((id) => id !== b.id);
              if (s.who.length !== n) hit = true;
            }
            return hit ? d : false;
          });
        }
        return json(200, { people: doc.people.map(pub) });
      }
      return fail(400, "Unknown action.");
    } catch (e) {
      return fail(500, String(e.message || e));
    }
  };
}
function memoryStore() {
  const m = /* @__PURE__ */ new Map();
  const read = (e, type) => type === "json" ? JSON.parse(e.value.toString("utf8")) : type === "arrayBuffer" ? e.value.buffer.slice(e.value.byteOffset, e.value.byteOffset + e.value.byteLength) : e.value.toString("utf8");
  const hold = (value) => Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value, "utf8") : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(String(value), "utf8");
  return {
    _map: m,
    async getWithMetadata(key, opts = {}) {
      const e = m.get(key);
      if (!e) return null;
      return { data: read(e, opts.type), etag: e.etag, metadata: e.metadata || {} };
    },
    async get(key, opts = {}) {
      const e = m.get(key);
      if (!e) return null;
      return read(e, opts.type);
    },
    async getMetadata(key) {
      const e = m.get(key);
      return e ? { etag: e.etag, metadata: e.metadata || {} } : null;
    },
    async list() {
      return { blobs: [...m.keys()].map((key) => ({ key, etag: (m.get(key) || {}).etag })) };
    },
    async delete(key) {
      m.delete(key);
    },
    async setJSON(key, value) {
      m.set(key, { value: Buffer.from(JSON.stringify(value), "utf8"), etag: randomBytes(6).toString("hex"), metadata: {} });
    },
    async set(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = randomBytes(6).toString("hex");
      m.set(key, { value: hold(value), etag, metadata: opts.metadata || {} });
      return { etag, modified: true };
    }
  };
}
var rota_default = createHandler((name) => getStore(name));
export {
  createHandler,
  rota_default as default,
  memoryStore,
  readTimes
};
