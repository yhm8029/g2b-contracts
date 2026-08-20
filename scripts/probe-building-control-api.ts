import { runBuildingControlApiContractProbe } from "@/lib/building-control/live-api-contract-probe";

runBuildingControlApiContractProbe().catch(() => {
  process.exitCode = 1;
});
