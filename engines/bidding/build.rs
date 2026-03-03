fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = "../../proto";

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(
            &[
                &format!("{proto_root}/common/v1/common.proto"),
                &format!("{proto_root}/user/v1/user.proto"),
                &format!("{proto_root}/bid/v1/bid.proto"),
            ],
            &[proto_root],
        )?;

    Ok(())
}
