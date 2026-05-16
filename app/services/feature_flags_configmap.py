"""Feature flags configmap service stub."""
def get_feature_flag(name: str, default: bool = False) -> bool:
    return default


_syncer = None

def get_configmap_syncer():
    return _syncer

def stop_configmap_syncer():
    pass
