use cc_switch_lib::WebServerOptions;

fn print_usage() {
    println!("Usage: cc-switch-web [options]");
    println!();
    println!("Options:");
    println!("  -b, --backend-port <PORT>   Preferred backend/web port");
    println!("      --host <HOST>           Bind host, default 127.0.0.1");
    println!("      --port-scan-count <N>   Number of ports to try starting from the preferred port");
    println!("  -h, --help                  Show this help message");
    println!();
    println!("Environment variables:");
    println!("  CC_SWITCH_WEB_HOST");
    println!("  CC_SWITCH_WEB_PORT");
    println!("  CC_SWITCH_WEB_PORT_SCAN_COUNT");
    println!("  CC_SWITCH_WEB_ACCESS_KEY    Optional Web API access key (minimum 16 characters)");
}

fn parse_u16_arg(flag: &str, value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|_| format!("invalid value for {flag}: {value}"))
}

fn parse_usize_arg(flag: &str, value: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("invalid value for {flag}: {value}"))?;

    if parsed == 0 {
        return Err(format!("{flag} must be greater than 0"));
    }

    Ok(parsed)
}

fn apply_long_option(options: &mut WebServerOptions, arg: &str) -> Result<(), String> {
    let Some((flag, value)) = arg.split_once('=') else {
        return Err(format!("unsupported argument: {arg}"));
    };

    match flag {
        "--host" => {
            options.host = value.to_string();
            Ok(())
        }
        "--backend-port" | "--port" => {
            options.preferred_port = parse_u16_arg(flag, value)?;
            Ok(())
        }
        "--port-scan-count" => {
            options.port_scan_count = parse_usize_arg(flag, value)?;
            Ok(())
        }
        _ => Err(format!("unsupported argument: {arg}")),
    }
}

fn parse_options() -> Result<Option<WebServerOptions>, String> {
    let mut options = WebServerOptions::from_env();
    let mut args = std::env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_usage();
                return Ok(None);
            }
            "--host" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--host requires a value".to_string())?;
                options.host = value;
            }
            "-b" | "--backend-port" | "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| format!("{arg} requires a value"))?;
                options.preferred_port = parse_u16_arg(arg.as_str(), &value)?;
            }
            "--port-scan-count" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--port-scan-count requires a value".to_string())?;
                options.port_scan_count = parse_usize_arg("--port-scan-count", &value)?;
            }
            _ if arg.starts_with("--host=")
                || arg.starts_with("--backend-port=")
                || arg.starts_with("--port=")
                || arg.starts_with("--port-scan-count=") =>
            {
                apply_long_option(&mut options, &arg)?;
            }
            _ => return Err(format!("unsupported argument: {arg}")),
        }
    }

    Ok(Some(options))
}

#[tokio::main]
async fn main() {
    let env = env_logger::Env::default().default_filter_or("info");
    let _ = env_logger::Builder::from_env(env)
        .format_timestamp_millis()
        .try_init();

    let options = match parse_options() {
        Ok(Some(options)) => options,
        Ok(None) => return,
        Err(error) => {
            eprintln!("{error}");
            eprintln!("Use --help to see available options.");
            std::process::exit(1);
        }
    };

    if let Err(error) = cc_switch_lib::run_web_server_with_options(options).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
