import eflowcodeLogo from "@/assets/icons/eflowcode.png";
import ddsLogo from "@/assets/icons/dds.png";
import lemondataLogo from "@/assets/icons/lemondata.png";
import lionccLogo from "@/assets/icons/lioncc.png";
import pipellmLogo from "@/assets/icons/pipellm.png";
import shengsuanyunLogo from "@/assets/icons/shengsuanyun.svg";
import patewayLogo from "@/assets/icons/pateway.jpg";
import claudeapiLogo from "@/assets/icons/claudeapi.png";
import claudecnLogo from "@/assets/icons/claudecn.png";
import runapiLogo from "@/assets/icons/runapi.jpg";
import relaxcodeLogo from "@/assets/icons/relaxcode.png";
import huoshanLogo from "@/assets/icons/huoshan.png";
import byteplusLogo from "@/assets/icons/byteplus.png";

const localIcons: Record<string, string> = {
  dds: ddsLogo,
  eflowcode: eflowcodeLogo,
  lemondata: lemondataLogo,
  lioncc: lionccLogo,
  pipellm: pipellmLogo,
  shengsuanyun: shengsuanyunLogo,
  pateway: patewayLogo,
  claudeapi: claudeapiLogo,
  claudecn: claudecnLogo,
  runapi: runapiLogo,
  relaxcode: relaxcodeLogo,
  huoshan: huoshanLogo,
  byteplus: byteplusLogo,
};

export const localIconList = Object.keys(localIcons);

export function hasLocalIcon(name: string): boolean {
  return name.toLowerCase() in localIcons;
}

export function getLocalIconUrl(name: string): string {
  return localIcons[name.toLowerCase()] || "";
}
