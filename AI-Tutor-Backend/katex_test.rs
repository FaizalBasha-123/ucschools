use katex;
fn main() {
    let opts = katex::Opts::builder()
        .display_mode(true)
        .output_type(katex::OutputType::Html)
        .error_color("#cc0000".to_string())
        .throw_on_error(false)
        .build()
        .unwrap();
    println!("{:?}", opts);
}
