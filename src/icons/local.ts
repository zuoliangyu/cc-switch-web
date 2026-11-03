import icon_tuzi from "@/icons/extracted/tuzi.png";
import icon_dmxapi from "@/icons/extracted/dmxapi.png";
import icon_bailing from "@/icons/extracted/bailing.png";
import icon_astron from "@/icons/extracted/astron.png";
import icon_88api from "@/icons/extracted/88api.png";
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
import icon_alltokens from "@/icons/extracted/alltokens.png";
import icon_alltokens_si from "@/icons/extracted/alltokens-si.png";
import icon_apikeyfun from "@/icons/extracted/apikeyfun.png";
import icon_apinebula from "@/icons/extracted/apinebula_icon.png";
import icon_atlascloud from "@/icons/extracted/atlascloud_icon.png";
import icon_ccsub from "@/icons/extracted/ccsub.svg";
import icon_cherryin from "@/icons/extracted/cherryin.png";
import icon_code0 from "@/icons/extracted/code0.png";
import icon_fenno from "@/icons/extracted/fenno-icon.png";
import icon_grooroute from "@/icons/extracted/grooroute.jpg";
import icon_hermes from "@/icons/extracted/hermes.png";
import icon_ikuncode from "@/icons/extracted/ikuncode.jpg";
import icon_modelflare from "@/icons/extracted/modelflare.jpg";
import icon_nekocode from "@/icons/extracted/nekocode-icon.png";
import icon_openmodel from "@/icons/extracted/openmodel.jpg";
import icon_ospreyai from "@/icons/extracted/ospreyai.png";
import icon_qiniu from "@/icons/extracted/qiniu.png";
import icon_runtoken from "@/icons/extracted/runtoken.jpg";
import icon_soruxgpt from "@/icons/extracted/soruxgpt.jpg";
import icon_streamlake from "@/icons/extracted/streamlake.svg";
import icon_subrouter from "@/icons/extracted/subrouter.svg";
import icon_sudocode from "@/icons/extracted/sudocode.png";
import icon_sudocode_us from "@/icons/extracted/sudocode-us.png";
import icon_teamorouter from "@/icons/extracted/TeamoRouter-icon-dark.png";
import icon_tokenflux from "@/icons/extracted/tokenflux.jpg";

const localIcons: Record<string, string> = {
  tuzi: icon_tuzi,
  dmxapi: icon_dmxapi,
  bailing: icon_bailing,
  astron: icon_astron,
  "88api": icon_88api,
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
  alltokens: icon_alltokens,
  "alltokens-si": icon_alltokens_si,
  apikeyfun: icon_apikeyfun,
  apinebula: icon_apinebula,
  atlascloud: icon_atlascloud,
  ccsub: icon_ccsub,
  cherryin: icon_cherryin,
  code0: icon_code0,
  fenno: icon_fenno,
  grooroute: icon_grooroute,
  hermes: icon_hermes,
  ikuncode: icon_ikuncode,
  modelflare: icon_modelflare,
  nekocode: icon_nekocode,
  openmodel: icon_openmodel,
  ospreyai: icon_ospreyai,
  qiniu: icon_qiniu,
  runtoken: icon_runtoken,
  soruxgpt: icon_soruxgpt,
  streamlake: icon_streamlake,
  subrouter: icon_subrouter,
  sudocode: icon_sudocode,
  "sudocode-us": icon_sudocode_us,
  teamorouter: icon_teamorouter,
  tokenflux: icon_tokenflux,
};

export const localIconList = Object.keys(localIcons);

export function hasLocalIcon(name: string): boolean {
  return name.toLowerCase() in localIcons;
}

export function getLocalIconUrl(name: string): string {
  return localIcons[name.toLowerCase()] || "";
}
