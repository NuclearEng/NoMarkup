/// Real-time fraud detection pipeline.
///
/// Handles browser fingerprinting, behavioral analysis, shill-bid detection,
/// and risk scoring. Target: < 50ms p99 latency.
pub struct FraudDetector;

impl FraudDetector {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Default for FraudDetector {
    fn default() -> Self {
        Self::new()
    }
}
