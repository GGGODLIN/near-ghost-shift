export const TESTNET_DEPLOYMENT = {
  "network": "testnet",
  "rpcUrl": "https://rpc.testnet.near.org",
  "accountId": "ghostshift-v1-mwbxwes8.testnet",
  "explorerUrl": "https://testnet.nearblocks.io/address/ghostshift-v1-mwbxwes8.testnet",
  "codeHash": "43xLujXYRoRB1PVptj5CeJ6HU3gs88EFeTR5dRFgwysP",
  "jobId": "audit-1794391011963",
  "transactions": [
    {
      "label": "deploy-initialize",
      "txHash": "A86u6a5dhMu4H8WaV4x7UyVmC46pcnhjoRWxR8iyw45D",
      "expectedFailure": false,
      "explorerUrl": "https://testnet.nearblocks.io/txns/A86u6a5dhMu4H8WaV4x7UyVmC46pcnhjoRWxR8iyw45D"
    },
    {
      "label": "redeploy",
      "txHash": "4qpfASRZYd15y18r9SyH2yrgJ1rxekPLKod4Za9N7YFC",
      "expectedFailure": false,
      "explorerUrl": "https://testnet.nearblocks.io/txns/4qpfASRZYd15y18r9SyH2yrgJ1rxekPLKod4Za9N7YFC"
    },
    {
      "label": "create-job",
      "txHash": "8Sy7D4VjXVsrnBdHwdFzfrtXMwVXd14cRjdiMwfw2tkE",
      "expectedFailure": false,
      "explorerUrl": "https://testnet.nearblocks.io/txns/8Sy7D4VjXVsrnBdHwdFzfrtXMwVXd14cRjdiMwfw2tkE"
    },
    {
      "label": "claim-epoch-1",
      "txHash": "eEmePLjsar1Mos2u5SpAaTCzSAq3Uk2Bqbpq9MnggGq",
      "expectedFailure": false,
      "explorerUrl": "https://testnet.nearblocks.io/txns/eEmePLjsar1Mos2u5SpAaTCzSAq3Uk2Bqbpq9MnggGq"
    },
    {
      "label": "takeover-epoch-2",
      "txHash": "uKYDX66zamiwNsbVUe6yuX7GKGmhSmeWFGzzKPd9omF",
      "expectedFailure": false,
      "explorerUrl": "https://testnet.nearblocks.io/txns/uKYDX66zamiwNsbVUe6yuX7GKGmhSmeWFGzzKPd9omF"
    },
    {
      "label": "reject-stale-epoch",
      "txHash": "7Ji9FnjihtpMNxzTy4Emk68Jrdo5g4a58N9vFzY5YXgx",
      "expectedFailure": true,
      "explorerUrl": "https://testnet.nearblocks.io/txns/7Ji9FnjihtpMNxzTy4Emk68Jrdo5g4a58N9vFzY5YXgx"
    }
  ]
} as const;
