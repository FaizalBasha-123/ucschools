"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { buildWsBaseUrl } from "@/lib/ws-ticket";

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { token, selectedSchoolId } = useAuth();
    const queryClient = useQueryClient();
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (!token || !selectedSchoolId) {
            return;
        }

        const wsUrl = `${buildWsBaseUrl()}/api/v1/events/ws?ticket=${encodeURIComponent(token)}`;
        let reconnectTimer: NodeJS.Timeout;
        let isComponentMounted = true;

        const connect = () => {
            if (!isComponentMounted) return;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.error) return;
                    
                    switch (data.type) {
                        case "USER_UPDATED":
                            queryClient.invalidateQueries({ queryKey: ["admin-users"] });
                            break;
                        case "STUDENT_UPDATED":
                            queryClient.invalidateQueries({ queryKey: ["admin-students"] });
                            break;
                        case "TEACHER_UPDATED":
                            queryClient.invalidateQueries({ queryKey: ["admin-teachers"] });
                            break;
                        case "STAFF_UPDATED":
                            queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
                            break;
                        case "FEES_UPDATED":
                            queryClient.invalidateQueries({ queryKey: ["fee-demands"] });
                            queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
                            break;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            };

            ws.onclose = () => {
                if (isComponentMounted) {
                    queryClient.invalidateQueries();
                    reconnectTimer = setTimeout(connect, 5000);
                }
            };

            ws.onerror = () => {
                ws.close();
            };
        };

        connect();

        return () => {
            isComponentMounted = false;
            clearTimeout(reconnectTimer);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, [token, selectedSchoolId, queryClient]);

    return <>{children}</>;
}
