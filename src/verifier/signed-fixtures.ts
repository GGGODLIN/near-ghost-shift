// Offline test signatures; the one-time signing key was discarded. No hardware attestation.
export const SIGNED_FIXTURES = [
  {
    "jobId": "job-split",
    "epoch": 2,
    "workerId": "worker-b.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-split\",\"epoch\":2,\"workerId\":\"worker-b.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0x988f08aee63cf1f42e9d6babd6c2eaee26df4db1c97d3070fe12d268099dc2047a3ee729ab8f2620d5ddfc514dddd7226a8cccf20754b8076d0bb944ef8e07441c"
  },
  {
    "jobId": "job-201",
    "epoch": 2,
    "workerId": "worker-b.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-201\",\"epoch\":2,\"workerId\":\"worker-b.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0x45cd3408d756f71bccd9cac188895a60b338a958520018f1b03d7582feae475c3790ad7c6aac7eb2d6a65495427b22f2864591b2253d492d3a490df7b9c871241b"
  },
  {
    "jobId": "job-split-01",
    "epoch": 2,
    "workerId": "worker-b.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-split-01\",\"epoch\":2,\"workerId\":\"worker-b.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0x5be91dfc3adc8b2e6b54c3659099178523896f92e04f81ccd9c04ef58a05df4c3876f8426b2089d52cb80d0109120f6f61c70bef04a34b78fa7f374019b73b0b1c"
  },
  {
    "jobId": "job-timeout-02",
    "epoch": 1,
    "workerId": "worker-a.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-timeout-02\",\"epoch\":1,\"workerId\":\"worker-a.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0xfe7f3efb882c0ae4cebca350c4f259d1fa548d1a8758eaa54ebaa7360d50765826d640b03ebe33573a1be6970267b9e94240ac39d471b9a551a9b50563499c141c"
  },
  {
    "jobId": "job-keyguard-03",
    "epoch": 1,
    "workerId": "worker-a.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-keyguard-03\",\"epoch\":1,\"workerId\":\"worker-a.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0x7badfdd1a61bb526230dd6b916ae385e808c617db1fd75d7809237681c5a51c24673f80084a508d87551230471d3377edfbfeae77c3e701c63ea97d4f2e8c52b1b"
  },
  {
    "jobId": "job-relay-04",
    "epoch": 3,
    "workerId": "worker-c.ghostshift.testnet",
    "signingAddress": "0x02c2c132600959dc09153192260bdccb0a387610",
    "signedMessage": "{\"domain\":\"ghostshift-v1\",\"jobId\":\"job-relay-04\",\"epoch\":3,\"workerId\":\"worker-c.ghostshift.testnet\",\"nonceHex\":\"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90\",\"model\":\"deepseek-ai/DeepSeek-V3.1\"}",
    "signatureHex": "0x75e22555ba8ed596eaa82a0a3614bb80788dc989b8398824da1cd69504ed60c71a2890c8cfd30169bf50805afeccad7635db7b9b506db2e60dfeda81cf4f5f291b"
  }
] as const;
