#!/bin/bash
set -euo pipefail
set -o pipefail

LOG_FILE="/var/log/ssl_renewal.log"
WEBROOT_PATH="/var/www/html"

# Get domains from environment variables, fallback to api.buywhere.ai for backward compatibility
DOMAINS="${ADDITIONAL_DOMAINS:-api.buywhere.ai}"
if [[ -n "$CERT_DOMAIN" && "$CERT_DOMAIN" != "api.buywhere.ai" ]]; then
    DOMAINS="$CERT_DOMAIN,$DOMAINS"
fi
# Remove duplicates and empty values
IFS=',' read -ra DOMAIN_ARRAY <<< "$DOMAINS"
DOMAINS=""
for domain in "${DOMAIN_ARRAY[@]}"; do
    if [[ -n "$domain" && ! "$DOMAINS" =~ (^|,)$domain(,|$) ]]; then
        DOMAINS="${DOMAINS:+$DOMAINS,}$domain"
    fi
done

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$LOG_FILE" >&2
}

setup_webroot() {
    if [[ ! -d "$WEBROOT_PATH" ]]; then
        log "Creating webroot directory at $WEBROOT_PATH"
        mkdir -p "$WEBROOT_PATH"
    fi
}

reload_nginx() {
    log "Reloading nginx after certificate renewal..."
    if systemctl reload nginx 2>&1 | tee -a "$LOG_FILE"; then
        log "nginx reloaded successfully"
    else
        error "Failed to reload nginx"
        return 1
    fi
    return 0
}

check_cert_expiry_for_domain() {
    local domain=$1
    local cert_dir="/etc/letsencrypt/live/$domain"
    local renewal_conf="/etc/letsencrypt/renewal/$domain.conf"
    
    if [[ ! -f "$cert_dir/fullchain.pem" ]]; then
        error "Certificate file not found at $cert_dir/fullchain.pem for domain $domain"
        return 1
    fi

    local expiry_date
    expiry_date=$(openssl x509 -in "$cert_dir/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
    if [[ -z "$expiry_date" ]]; then
        error "Could not read certificate expiry date for domain $domain"
        return 1
    fi

    local expiry_epoch
    expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null)
    local now_epoch
    now_epoch=$(date +%s)
    local days_until_expiry=$(( (expiry_epoch - now_epoch) / 86400 ))

    log "Certificate for $domain expires: $expiry_date ($days_until_expiry days)"
    echo "$days_until_expiry"
}

renew_certs_for_domain() {
    local domain=$1
    local cert_dir="/etc/letsencrypt/live/$domain"
    local renewal_conf="/etc/letsencrypt/renewal/$domain.conf"
    
    log "Starting SSL certificate renewal check for $domain..."

    if ! command -v certbot &> /dev/null; then
        error "certbot not found in PATH"
        return 1
    fi

    setup_webroot

    if [[ ! -f "$renewal_conf" ]]; then
        error "Renewal configuration not found at $renewal_conf"
        error "Please deploy certbot/renewal/$domain.conf to $renewal_conf"
        return 1
    fi

    local days_until_expiry
    days_until_expiry=$(check_cert_expiry_for_domain "$domain")

    if [[ $days_until_expiry -lt 0 ]]; then
        error "Certificate for $domain has already expired!"
        return 1
    fi

    if [[ $days_until_expiry -lt 30 ]]; then
        log "Certificate for $domain expires in $days_until_expiry days, attempting renewal..."
        if certbot renew --quiet --conf "$renewal_conf" 2>&1 | tee -a "$LOG_FILE"; then
            log "Certificate renewal completed for $domain"
            reload_nginx
            return 0
        else
            error "Certificate renewal failed for $domain"
            return 1
        fi
    else
        log "Certificate for $domain still valid for $days_until_expiry days, no renewal needed"
        return 0
    fi
}

renew_all_certs() {
    log "Starting SSL certificate renewal process for domains: $DOMAINS"
    
    # Convert comma-separated string to array
    IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
    
    local overall_status=0
    for domain in "${DOMAIN_LIST[@]}"; do
        if [[ -n "$domain" ]]; then
            log "Processing domain: $domain"
            renew_certs_for_domain "$domain" || overall_status=1
        fi
    done
    
    return $overall_status
}

check_all_certs() {
    log "Checking SSL certificate status for domains: $DOMAINS"
    
    # Convert comma-separated string to array
    IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
    
    local overall_status=0
    for domain in "${DOMAIN_LIST[@]}"; do
        if [[ -n "$domain" ]]; then
            log "Checking domain: $domain"
            check_cert_expiry_for_domain "$domain" || overall_status=1
        fi
    done
    
    return $overall_status
}

case "${1:-renew}" in
    check)
        check_all_certs
        ;;
    renew)
        renew_all_certs
        ;;
    *)
        echo "Usage: $0 {check|renew}"
        exit 1
        ;;
esac