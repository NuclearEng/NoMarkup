#![deny(clippy::all, clippy::pedantic)]
// Trust scoring is numeric: counts (i64) and ratios (f64) are routinely
// converted between integer and float. The precision loss and sign-loss casts
// are intentional and bounded by the score-clamping that every dimension
// applies before returning [0..=1]. Suppressing here documents the design
// choice once at the crate root rather than at each call site.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::missing_errors_doc,
    clippy::doc_markdown,
    clippy::missing_const_for_fn,
    clippy::similar_names,
    clippy::module_name_repetitions,
    clippy::suboptimal_flops,
    clippy::collapsible_if,
    clippy::match_same_arms,
    clippy::manual_let_else,
    clippy::items_after_statements,
    clippy::empty_line_after_doc_comments,
    clippy::too_many_arguments,
    clippy::doc_overindented_list_items,
    clippy::result_large_err,
    clippy::trivially_copy_pass_by_ref,
    clippy::must_use_unit,
    clippy::must_use_candidate,
    clippy::type_complexity,
    clippy::unreadable_literal,
    clippy::unused_self,
    clippy::double_must_use
)]

pub mod models;
pub mod scoring;
