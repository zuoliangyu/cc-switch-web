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
import a6apiLogo from "@/assets/icons/a6-icon.png";
import xycaiLogo from "@/assets/icons/xycai-icon.png";
import fluxaLogo from "@/assets/icons/fluxa.png";
import soshowLogo from "@/assets/icons/soshow.png";
import sub2apiLogo from "@/assets/icons/sub2api.svg";

const localIcons: Record<string, string> = {
  a6api: a6apiLogo,
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
  xycai: xycaiLogo,
  fluxa: fluxaLogo,
  soshow: soshowLogo,
  sub2api: sub2apiLogo,
};

export const localIconList = Object.keys(localIcons);

export function hasLocalIcon(name: string): boolean {
  return name.toLowerCase() in localIcons;
}

export function getLocalIconUrl(name: string): string {
  return localIcons[name.toLowerCase()] || "";
}
